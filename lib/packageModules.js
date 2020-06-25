'use strict';

const BbPromise = require('bluebird');
const _ = require('lodash');
const path = require('path');
const bestzip = require('bestzip');
const glob = require('glob');
const semver = require('semver');

function setArtifactPath(funcName, func, artifactPath) {
  const version = this.serverless.getVersion();

  // Serverless changed the artifact path location in version 1.18
  if (semver.lt(version, '1.18.0')) {
    func.artifact = artifactPath;
    func.package = _.assign({}, func.package, { disable: true });
    this.serverless.cli.log(`${funcName} is packaged by the webpack plugin. Ignore messages from SLS.`);
  } else {
    func.package = {
      artifact: artifactPath
    };
  }
}

function zip(directory, name) {
  const files = glob.sync('**', {
    cwd: directory,
    dot: true,
    silent: true,
    follow: true
  });

  if (_.isEmpty(files)) {
    const error = new this.serverless.classes.Error('Packaging: No files found');
    return BbPromise.reject(error);
  }
  const artifactRootPath = path.join(this.serverless.config.servicePath, '.serverless');
  const artifactFilePath = path.join(artifactRootPath, name);
  this.serverless.utils.writeFileDir(artifactFilePath);

  const cwd = directory;
  const source = '*';
  const destination = path.relative(cwd, artifactFilePath);
  const zipArgs = {
    source,
    cwd,
    destination
  };
  return new BbPromise((resolve, reject) => {
    bestzip(zipArgs)
      .then(() => {
        resolve(artifactFilePath);
        return null;
      })
      .catch(err => {
        reject(err);
      });
  });
}

module.exports = {
  packageModules() {
    const stats = this.compileStats;

    return BbPromise.mapSeries(stats.stats, (compileStats, index) => {
      const entryFunction = _.get(this.entryFunctions, index, {});
      const filename = `${entryFunction.funcName || this.serverless.service.getServiceObject().name}.zip`;
      const modulePath = compileStats.compilation.compiler.outputPath;

      const startZip = _.now();
      return zip
        .call(this, modulePath, filename)
        .tap(
          () =>
            this.options.verbose &&
            this.serverless.cli.log(
              `${new Date().toUTCString()} Zip ${
                _.isEmpty(entryFunction) ? 'service' : 'function'
              }: ${modulePath} [${_.now() - startZip} ms]`
            )
        )
        .then(artifactPath => {
          if (_.get(this.serverless, 'service.package.individually')) {
            setArtifactPath.call(
              this,
              entryFunction.funcName,
              entryFunction.func,
              path.relative(this.serverless.config.servicePath, artifactPath)
            );
          }
          return artifactPath;
        });
    }).then(artifacts => {
      if (!_.get(this.serverless, 'service.package.individually') && !_.isEmpty(artifacts)) {
        // Set the service artifact to all functions
        const allFunctionNames = this.serverless.service.getAllFunctions();
        _.forEach(allFunctionNames, funcName => {
          const func = this.serverless.service.getFunction(funcName);
          setArtifactPath.call(this, funcName, func, path.relative(this.serverless.config.servicePath, artifacts[0]));
        });
        // For Google set the service artifact path
        if (_.get(this.serverless, 'service.provider.name') === 'google') {
          _.set(
            this.serverless,
            'service.package.artifact',
            path.relative(this.serverless.config.servicePath, artifacts[0])
          );
        }
      }

      return null;
    });
  }
};
