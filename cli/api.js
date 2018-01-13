const fs = require('fs');
const os = require('os');
const npmName = require('npm-name');
const pify = require('pify');
const recast = require('recast');

const fileName = `${os.homedir()}/.hyper.js`;

/**
 * We need to make sure the file reading and parsing is lazy so that failure to
 * statically analyze the hyper configuration isn't fatal for all kinds of
 * subcommands. We can use memoization to make reading and parsing lazy.
 */
function memoize(fn) {
  let hasResult = false;
  let result;
  return (...args) => {
    if (!hasResult) {
      result = fn(...args);
      hasResult = true;
    }
    return result;
  };
}

const getFileContents = memoize(() => {
  try {
    return fs.readFileSync(fileName, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // ENOENT === !exists()
      throw err;
    }
  }
  return null;
});

const getParsedFile = memoize(() => recast.parse(getFileContents()));

const getProperties = memoize(() => getParsedFile().program.body[0].expression.right.properties);

const getPlugins = memoize(() => getProperties().find(property => property.key.name === 'plugins').value.elements);

const getLocalPlugins = memoize(
  () => getProperties().find(property => property.key.name === 'localPlugins').value.elements
);

function exists() {
  return getFileContents() !== undefined;
}

function isInstalled(plugin, locally) {
  const array = locally ? getLocalPlugins() : getPlugins();
  if (array && Array.isArray(array)) {
    return array.find(entry => entry.value === plugin) !== undefined;
  }
  return false;
}

function save() {
  return pify(fs.writeFile)(fileName, recast.print(getParsedFile()).code, 'utf8');
}

function existsOnNpm(plugin) {
  plugin = plugin.split('#')[0].split('@')[0];
  return npmName(plugin).then(unavailable => {
    if (unavailable) {
      const err = new Error(`${plugin} not found on npm`);
      err.code = 'NOT_FOUND_ON_NPM';
      throw err;
    }
  });
}

function install(plugin, locally) {
  const array = locally ? getLocalPlugins() : getPlugins();
  return new Promise((resolve, reject) => {
    existsOnNpm(plugin)
      .then(() => {
        if (isInstalled(plugin, locally)) {
          return reject(`${plugin} is already installed`);
        }

        array.push(recast.types.builders.literal(plugin));
        save()
          .then(resolve)
          .catch(err => reject(err));
      })
      .catch(err => {
        if (err.code === 'NOT_FOUND_ON_NPM') {
          reject(err.message);
        } else {
          reject(err);
        }
      });
  });
}

function uninstall(plugin) {
  return new Promise((resolve, reject) => {
    if (!isInstalled(plugin)) {
      return reject(`${plugin} is not installed`);
    }

    const index = getPlugins().findIndex(entry => entry.value === plugin);
    getPlugins().splice(index, 1);
    save()
      .then(resolve)
      .catch(err => reject(err));
  });
}

function list() {
  if (Array.isArray(getPlugins())) {
    return getPlugins()
      .map(plugin => plugin.value)
      .join('\n');
  }
  return false;
}

module.exports.configPath = fileName;
module.exports.exists = exists;
module.exports.existsOnNpm = existsOnNpm;
module.exports.isInstalled = isInstalled;
module.exports.install = install;
module.exports.uninstall = uninstall;
module.exports.list = list;
