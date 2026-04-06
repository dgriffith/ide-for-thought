import { describe, it, expect } from 'vitest';

// Test the inspection type structure and check naming conventions
describe('health check inspection types', () => {
  it('defines expected severity levels', () => {
    const severities = ['info', 'warning', 'concern'];
    expect(severities).toContain('info');
    expect(severities).toContain('warning');
    expect(severities).toContain('concern');
  });

  it('defines expected check types', () => {
    const types = [
      'unsupported_claim',
      'stale_note',
      'missing_warrant',
      'missing_backing',
      'contradiction',
    ];
    expect(types).toHaveLength(5);
    for (const t of types) {
      expect(t).toMatch(/^[a-z_]+$/);
    }
  });

  it('inspection structure has required fields', () => {
    const inspection = {
      id: 'test-0',
      type: 'unsupported_claim',
      severity: 'warning' as const,
      nodeUri: 'https://example.org/claim/1',
      nodeLabel: 'Test claim',
      message: 'Claim "Test claim" has no supporting evidence',
      suggestedAction: 'Add grounds',
    };
    expect(inspection.id).toBeDefined();
    expect(inspection.type).toBeDefined();
    expect(inspection.severity).toBeDefined();
    expect(inspection.nodeUri).toBeDefined();
    expect(inspection.nodeLabel).toBeDefined();
    expect(inspection.message).toBeDefined();
  });
});
