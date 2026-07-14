module.exports = {
  packagerConfig: {
    name: "Roughdraft",
    executableName: "Roughdraft",
    appBundleId: "is.pjh.roughdraft",
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
