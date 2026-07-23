# String tension at pitch

```python
# Tension (N) for a steel E string tuned to 659.3 Hz
L = 0.34      # vibrating length (m)
mu = 3.9e-4   # mass per unit length (kg/m)
f = 659.3
T = mu * (2 * L * f) ** 2
print(f"{T:.1f} N")
```
