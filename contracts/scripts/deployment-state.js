const fs = require("fs");
const path = require("path");

function getDeploymentPath(networkName) {
  return path.join(__dirname, "..", "deployments", `${networkName}.json`);
}

function readDeploymentState(networkName) {
  const filePath = getDeploymentPath(networkName);
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return {};
  }
}

function writeDeploymentState(networkName, nextState) {
  const filePath = getDeploymentPath(networkName);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(nextState, null, 2)}\n`);
}

function mergeDeploymentState(networkName, patch) {
  const current = readDeploymentState(networkName);
  const nextState = { ...current, ...patch };
  writeDeploymentState(networkName, nextState);
  return nextState;
}

module.exports = {
  getDeploymentPath,
  mergeDeploymentState,
  readDeploymentState,
  writeDeploymentState,
};
