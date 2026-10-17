// Bundles the Worker with Bun. The reset reseeds through packages/db seed.ts, whose readCsv reads three CSVs from disk;
// a Worker has no disk, so the CSVs go into the bundle and readCsv reads them from there.
const data = new URL("../../data/", import.meta.url);
const csv = Object.fromEntries(await Promise.all(["icd10.csv", "drugs.csv", "follow-up-rules.csv"].map(async f => [f, await Bun.file(new URL(f, data)).text()])));
const read = 'readFileSync(fileURLToPath(new URL(`../../../data/${file}`, import.meta.url).href), "utf8")';
const result = await Bun.build({
  entrypoints: ["src/index.ts"], outdir: "dist", target: "browser", format: "esm", minify: true,
  plugins: [{
    name: "seed-csv",
    setup(b) {
      b.onLoad({ filter: /packages\/db\/src\/seed\.ts$/ }, async ({ path }) => {
        const src = await Bun.file(path).text();
        if (!src.includes(read)) throw new Error("seed.ts readCsv changed: update apps/demo-prep/build.ts");
        return { loader: "ts", contents: src.replace(read, `(${JSON.stringify(csv)})[file]`).replace(/^import .* from "node:(fs|url)";$/gm, "") };
      });
    },
  }],
});
if (!result.success) { console.error(result.logs); process.exit(1); }
console.log("built", result.outputs.map(o => `${o.path} ${(o.size / 1024).toFixed(0)} KB`).join(", "));
