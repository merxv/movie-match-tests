const [url, timeoutArg = "120000", label = "service"] = process.argv.slice(2);

if (!url) {
  throw new Error("Usage: node wait-for-http.mjs <url> [timeoutMs] [label]");
}

const timeoutMs = Number.parseInt(timeoutArg, 10);
const deadline = Date.now() + timeoutMs;

let lastError = "No response yet";

while (Date.now() < deadline) {
  try {
    const response = await fetch(url, { redirect: "manual" });
    if (response.ok || (response.status >= 300 && response.status < 400)) {
      console.log(`${label} is ready at ${url}`);
      process.exit(0);
    }

    lastError = `HTTP ${response.status}`;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));
}

throw new Error(`Timed out waiting for ${label} at ${url}. Last error: ${lastError}`);
