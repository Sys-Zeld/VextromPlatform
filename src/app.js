const { initializeSpecflow, startSpecflowServer } = require("../specflow/app");

initializeSpecflow()
  .then(() => {
    startSpecflowServer();
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Startup failed:", err.message);
    process.exit(1);
  });
