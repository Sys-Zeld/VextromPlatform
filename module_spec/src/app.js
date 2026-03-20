const { createModuleSpecRouter } = require("./routes");

function registerModuleSpec(app, deps) {
  app.use("/api/module-spec", createModuleSpecRouter(deps));
}

module.exports = {
  registerModuleSpec
};
