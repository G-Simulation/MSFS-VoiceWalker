const copyStaticFiles = require("esbuild-copy-static-files");
const globalExternals = require("@fal-works/esbuild-plugin-global-externals");
const { typecheckPlugin } = require("@jgoz/esbuild-plugin-typecheck");
const esbuild = require("esbuild");
const postcss = require("postcss");
const postCssUrl = require("postcss-url");
const postcssPrefixSelector = require("postcss-prefix-selector");
const sassPlugin = require("esbuild-sass-plugin");

require("dotenv").config({ path: __dirname + "/.env" });

const env = {
  typechecking: process.env.TYPECHECKING === "true",
  sourcemaps: process.env.SOURCE_MAPS === "true",
  minify: process.env.MINIFY === "true",
  // Public-Release: VW_DEBUG_BUILD nicht "true" → debug.js wird nach
  // copyStaticFiles aus dist/web/ entfernt und der zugehoerige <script>-Tag
  // aus dist/web/index.html gestrippt. wixproj setzt diese Env-Var
  // explizit basierend auf $(VWDebugBuild).
  debugBuild: process.env.VW_DEBUG_BUILD === "true",
};

// Plugin: nach copyStaticFiles laeuft, im Public-Build dist/web/debug.js
// loeschen und den <script ... /debug.js>-Tag aus dist/web/index.html
// strippen. Sonst landet das Strg+Shift+D-Overlay im EFB-Bundle.
const stripWebDebugPlugin = {
  name: "strip-web-debug",
  setup(build) {
    build.onEnd(() => {
      if (env.debugBuild) {
        console.log("[strip-web-debug] VW_DEBUG_BUILD=true — debug.js bleibt im EFB-Bundle.");
        return;
      }
      const fs = require("fs");
      const path = require("path");
      const debugJs = path.join(__dirname, "dist", "web", "debug.js");
      const indexHtml = path.join(__dirname, "dist", "web", "index.html");
      try {
        if (fs.existsSync(debugJs)) {
          fs.unlinkSync(debugJs);
          console.log("[strip-web-debug] geloescht: dist/web/debug.js");
        }
      } catch (e) {
        console.warn("[strip-web-debug] konnte debug.js nicht loeschen:", e.message);
      }
      try {
        if (fs.existsSync(indexHtml)) {
          const before = fs.readFileSync(indexHtml, "utf8");
          const after = before.replace(
            /[ \t]*<script\b[^>]*\bsrc=["']\/?debug\.js["'][^>]*><\/script>\s*\n?/g,
            ""
          );
          if (after !== before) {
            fs.writeFileSync(indexHtml, after);
            console.log("[strip-web-debug] <script src=debug.js> aus index.html entfernt");
          }
        }
      } catch (e) {
        console.warn("[strip-web-debug] konnte index.html nicht patchen:", e.message);
      }
    });
  },
};

const baseConfig = {
  entryPoints: ["src/VoiceWalkerApp.tsx"],
  keepNames: true,
  bundle: true,
  outdir: "dist",
  sourcemap: env.sourcemaps,
  minify: env.minify,
  logLevel: "debug",
  loader: {
    ".html": "copy",
  },
  target: "es2017",
  define: { BASE_URL: `"coui://html_ui/efb_ui/efb_apps/VoiceWalkerApp"` },
  plugins: [
    copyStaticFiles({
      src: "./src/Assets",
      dest: "./dist/Assets",
    }),
    // Die volle Web-UI (gleicher Code wie Tray-App) ins EFB-Bundle
    // mitkopieren. iframe laedt die dann via coui:// (same-origin),
    // weil http://localhost von Coherent GT im EFB silent geblockt
    // wird. Die UI darin verbindet sich via WebSocket zu localhost:7801
    // — das ist erlaubt weil der Frame selbst keine Cross-Origin-
    // Restriktionen mehr hat.
    copyStaticFiles({
      src: "../../../../web",
      dest: "./dist/web",
    }),
    globalExternals.globalExternals({
      "@microsoft/msfs-sdk": {
        varName: "msfssdk",
        type: "cjs",
      },
      "@workingtitlesim/garminsdk": {
        varName: "garminsdk",
        type: "cjs",
      },
    }),
    sassPlugin.sassPlugin({
      async transform(source) {
        const { css } = await postcss([
          postCssUrl({
            url: "copy",
          }),
          postcssPrefixSelector({
            prefix: `.efb-view.${__dirname.split("\\").at(-1)}`,
          }),
        ]).process(source, { from: undefined });
        return css;
      },
    }),
    // MUSS nach copyStaticFiles stehen, sonst wird debug.js gestrippt
    // BEVOR es kopiert wird (Plugin-Reihenfolge = onEnd-Reihenfolge).
    stripWebDebugPlugin,
  ],
};

if (env.typechecking) {
  baseConfig.plugins.push(
    typecheckPlugin({ watch: process.env.SERVING_MODE === "WATCH" })
  );
}

if (process.env.SERVING_MODE === "WATCH") {
  esbuild.context(baseConfig).then((ctx) => ctx.watch());
} else if (process.env.SERVING_MODE === "SERVE") {
  esbuild
    .context(baseConfig)
    .then((ctx) => ctx.serve({ port: process.env.PORT_SERVER }));
} else if (["", undefined].includes(process.env.SERVING_MODE)) {
  esbuild.build(baseConfig);
} else {
  console.error(`MODE ${process.env.SERVING_MODE} is unknown`);
}
