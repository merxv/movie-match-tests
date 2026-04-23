const durationMs = Number(process.argv[2] || 10000);
const deadline = Date.now() + durationMs;

while (Date.now() < deadline) {
  let value = 0;
  for (let index = 0; index < 5_000_000; index += 1) {
    value += Math.sqrt(index % 1000);
  }

  if (value < 0) {
    console.log(value);
  }
}
