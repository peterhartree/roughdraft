const path = require("node:path");

module.exports = {
  packagerConfig: {
    name: "Roughdraft",
    executableName: "Roughdraft",
    appBundleId: "is.pjh.roughdraft",
    icon: path.resolve(__dirname, "assets/icon.icns"),
    extendInfo: {
      CFBundleDocumentTypes: [
        {
          CFBundleTypeExtensions: ["md"],
          CFBundleTypeName: "Markdown document",
          CFBundleTypeRole: "Editor",
          LSHandlerRank: "Alternate",
        },
      ],
    },
    asar: true,
    prune: false,
    ignore: [
      /^\/node_modules($|\/)/,
      /^\/src($|\/)/,
      /^\/out($|\/)/,
      /^\/forge\.config\.cjs$/,
      /^\/tsconfig\.json$/,
    ],
  },
};
