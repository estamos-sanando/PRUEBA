const fs = require("fs");
const path = require("path");

const root = "d:/Malvinas";
const css = fs.readFileSync(path.join(root, "css/styles.css"), "utf8");
const manifest = fs.readFileSync(path.join(root, "js/assets-manifest.js"), "utf8");
const audio = fs.readFileSync(path.join(root, "js/audio.js"), "utf8");
const processor = fs.readFileSync(path.join(root, "js/asset-processor.js"), "utf8");
const controls = fs.readFileSync(path.join(root, "js/controls.js"), "utf8");
const newsgaming = fs.readFileSync(path.join(root, "js/newsgaming.js"), "utf8");
const layers = fs.readFileSync(path.join(root, "js/layers.js"), "utf8");
const main = fs.readFileSync(path.join(root, "js/main.js"), "utf8");

let html = fs.readFileSync(path.join(root, "index.html"), "utf8");

// Reemplazar link css por style tag
html = html.replace('<link rel="stylesheet" href="css/styles.css" />', `<style>\n${css}\n</style>`);

// Reemplazar script tags por scripts inlines
const scriptBlock = `
    <script>
      ${manifest}
    </script>
    <script>
      ${audio}
    </script>
    <script>
      ${processor}
    </script>
    <script>
      ${controls}
    </script>
    <script>
      ${newsgaming}
    </script>
    <script>
      ${layers}
    </script>
    <script>
      ${main}
    </script>
`;

html = html.replace(
  /<!-- Scripts modulares ordenados[\s\S]*?<\/script>\s*<\/body>/,
  `<!-- Versión auto-contenida Newsgaming Malvinas 1982 -->\n${scriptBlock}\n  </body>`
);

fs.writeFileSync(path.join(root, "sheffield_1982_standalone.html"), html, "utf8");
console.log("Successfully built sheffield_1982_standalone.html. Size:", (fs.statSync(path.join(root, "sheffield_1982_standalone.html")).size / 1024).toFixed(1), "KB");
