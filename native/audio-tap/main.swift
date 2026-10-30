// minerva-audio-tap — records the sound the Mac plays, for meeting
// recordings (#2731).
//
// A Core Audio process tap (macOS 14.2+) over every process's output, read
// through a private aggregate device. It needs only the "System Audio
// Recording Only" permission. Electron's built-in route (`getDisplayMedia`
// loopback) needs a screen source too, which asks to record the screen.
//
// Protocol, read by `src/main/voice/system-audio-tap.ts`:
//   stdout  raw interleaved float32 little-endian PCM, nothing else
//   stderr  one JSON line: {"ready":true,"sampleRate":N,"channels":N}
//           or {"error":"…","status":N} before exiting 1
//   stdin   closed (or SIGTERM / SIGINT) → stop, tear down, exit 0
//
// Exiting on stdin EOF is what keeps the helper from outliving Minerva: the
// pipe closes however the parent goes. The tap and aggregate device are
// private, so the system drops them with the process anyway.

import AudioToolbox
import CoreAudio
import Foundation

setvbuf(stderr, nil, _IONBF, 0)
signal(SIGPIPE, SIG_IGN)

func report(_ object: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: object),
        let line = String(data: data, encoding: .utf8) else { return }
  FileHandle.standardError.write((line + "\n").data(using: .utf8)!)
}

func fail(_ message: String, _ status: OSStatus = 0) -> Never {
  report(["error": message, "status": Int(status)])
  exit(1)
}

func property<T>(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector, _ initial: T) -> (OSStatus, T) {
  var address = AudioObjectPropertyAddress(
    mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var value = initial
  var size = UInt32(MemoryLayout<T>.size)
  let status = withUnsafeMutablePointer(to: &value) {
    AudioObjectGetPropertyData(object, &address, 0, nil, &size, $0)
  }
  return (status, value)
}

guard #available(macOS 14.2, *) else { fail("System audio recording needs macOS 14.2 or later.") }

// The default output device clocks the aggregate.
let (outStatus, outputDevice) = property(
  AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultSystemOutputDevice, AudioObjectID(kAudioObjectUnknown))
if outStatus != noErr { fail("No output device.", outStatus) }
let (uidStatus, uidRef) = property(outputDevice, kAudioDevicePropertyDeviceUID, Unmanaged<CFString>?.none)
guard uidStatus == noErr, let uidRef else { fail("Couldn't read the output device.", uidStatus) }
let outputUID = uidRef.takeRetainedValue() as String

let tapDescription = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
tapDescription.uuid = UUID()
tapDescription.name = "Minerva meeting recording"
tapDescription.isPrivate = true
tapDescription.muteBehavior = .unmuted

var tapID = AudioObjectID(kAudioObjectUnknown)
var status = AudioHardwareCreateProcessTap(tapDescription, &tapID)
if status != noErr { fail("Couldn't create the audio tap.", status) }

let (formatStatus, format) = property(tapID, kAudioTapPropertyFormat, AudioStreamBasicDescription())
if formatStatus != noErr { fail("Couldn't read the tap's format.", formatStatus) }
guard format.mFormatID == kAudioFormatLinearPCM,
      format.mFormatFlags & kAudioFormatFlagIsFloat != 0,
      format.mBitsPerChannel == 32 else {
  fail("The tap's format isn't 32-bit float PCM.")
}
let channels = Int(format.mChannelsPerFrame)
let nonInterleaved = format.mFormatFlags & kAudioFormatFlagIsNonInterleaved != 0

let aggregate: [String: Any] = [
  kAudioAggregateDeviceNameKey: "Minerva meeting recording",
  kAudioAggregateDeviceUIDKey: UUID().uuidString,
  kAudioAggregateDeviceMainSubDeviceKey: outputUID,
  kAudioAggregateDeviceIsPrivateKey: true,
  kAudioAggregateDeviceIsStackedKey: false,
  kAudioAggregateDeviceTapAutoStartKey: true,
  kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outputUID]],
  kAudioAggregateDeviceTapListKey: [[
    kAudioSubTapDriftCompensationKey: true,
    kAudioSubTapUIDKey: tapDescription.uuid.uuidString,
  ]],
]
var aggregateID = AudioObjectID(kAudioObjectUnknown)
status = AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &aggregateID)
if status != noErr { fail("Couldn't create the recording device.", status) }

let stdout = FileHandle.standardOutput
let queue = DispatchQueue(label: "minerva.audio-tap", qos: .userInitiated)
var interleaved = [Float]()

var procID: AudioDeviceIOProcID?
status = AudioDeviceCreateIOProcIDWithBlock(&procID, aggregateID, queue) { _, input, _, _, _ in
  let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
  if !nonInterleaved {
    for buffer in buffers where buffer.mDataByteSize > 0 {
      if let data = buffer.mData { stdout.write(Data(bytes: data, count: Int(buffer.mDataByteSize))) }
    }
    return
  }
  // One buffer per channel: interleave them so the reader sees one layout.
  guard buffers.count == channels, let first = buffers.first else { return }
  let frames = Int(first.mDataByteSize) / MemoryLayout<Float>.size
  if frames == 0 { return }
  interleaved.removeAll(keepingCapacity: true)
  interleaved.reserveCapacity(frames * channels)
  let planes = buffers.map { $0.mData?.assumingMemoryBound(to: Float.self) }
  for frame in 0..<frames {
    for plane in planes { interleaved.append(plane?[frame] ?? 0) }
  }
  interleaved.withUnsafeBytes { stdout.write(Data($0)) }
}
if status != noErr { fail("Couldn't attach to the recording device.", status) }

@Sendable func teardown() {
  if let procID {
    AudioDeviceStop(aggregateID, procID)
    AudioDeviceDestroyIOProcID(aggregateID, procID)
  }
  AudioHardwareDestroyAggregateDevice(aggregateID)
  AudioHardwareDestroyProcessTap(tapID)
}

status = AudioDeviceStart(aggregateID, procID)
if status != noErr {
  teardown()
  fail("Couldn't start recording.", status)
}

report(["ready": true, "sampleRate": format.mSampleRate, "channels": channels])

@Sendable func stop() -> Never {
  teardown()
  exit(0)
}

var sources: [DispatchSourceSignal] = []
for sig in [SIGTERM, SIGINT] {
  signal(sig, SIG_IGN)
  let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
  source.setEventHandler { stop() }
  source.resume()
  sources.append(source)
}

DispatchQueue.global(qos: .utility).async {
  // Blocks until the parent closes the pipe (or goes away).
  _ = FileHandle.standardInput.readDataToEndOfFile()
  DispatchQueue.main.async { stop() }
}

dispatchMain()
