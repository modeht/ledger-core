// Builds one standalone program for each computer we support.
// Each program lands in dist/ with the system name in its file name.

const targets = [
  "bun-darwin-arm64",
  "bun-darwin-x64",
  "bun-linux-arm64",
  "bun-linux-x64",
  "bun-windows-x64",
] as const;

let failed = 0;

for (const target of targets) {
  // "bun-linux-x64" becomes "linux-x64".
  const name = target.replace(/^bun-/, "");
  // Windows programs need the .exe ending.
  const ending = name.startsWith("windows") ? ".exe" : "";
  const outfile = `dist/ledger-replay-${name}${ending}`;

  // Use the same Bun program that runs this script.
  const result = Bun.spawnSync(
    [process.execPath, "build", "--compile", `--target=${target}`, "src/main.ts", "--outfile", outfile],
    { stdout: "inherit", stderr: "inherit" },
  );

  if (result.exitCode === 0) {
    console.log(`ok     ${target} -> ${outfile}`);
  } else {
    failed += 1;
    console.log(`failed ${target} (exit code ${result.exitCode})`);
  }
}

// Stop with an error if any build did not work.
if (failed > 0) {
  console.log(`${failed} of ${targets.length} builds failed`);
  process.exit(1);
}
