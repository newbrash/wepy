const path = require('path');
const loaderUtils = require('loader-utils');
const { AppChain, PageChain } = require('../../compile/chain');
const JsonSource = require('../../compile/source').JsonSource;

let appUsingComponents = null;

exports = module.exports = function() {
  this.register('parse-config', function(chain) {
    const bead = chain.bead;
    const compiledCode = bead.compiled.code;
    const isApp = chain.previous instanceof AppChain;
    const isPage = chain.previous instanceof PageChain;

    let source = null;
    let configString = compiledCode.replace(/^\n*/, '').replace(/\n*$/, '');
    configString = (configString || '{}').trim();

    try {
      source = new JsonSource(configString);
    } catch (err) {
      return Promise.reject(err.message);
    }

    let meta = source.meta();

    if (isApp) {
      meta.component = true;
    }
    if (!meta.usingComponents) {
      meta.usingComponents = {};
    }

    let userDefineComponents = meta.usingComponents || {};
    let appDefinedComponents = {};
    let componentKeys = Object.keys(meta.usingComponents);

    if (!appUsingComponents && componentKeys.length === 0) {
      bead.parsed = {
        code: source
      };
      return Promise.resolve(true);
    }

    // page Components will inherit app using components
    if (appUsingComponents && isPage) {
      appUsingComponents.forEach(comp => {
        // Existing in page components, then ignore
        // Resolve path for page components
        if (!userDefineComponents[comp.name]) {
          let targetPath = comp.resolved.path;
          if (comp.prefix === 'module') {
            targetPath = comp.target;
          }
          const relativePath = path.relative(path.dirname(bead.path), targetPath);
          const parsedPath = path.parse(relativePath);
          // Remove wpy ext
          appDefinedComponents[comp.name] = path.join(parsedPath.dir, parsedPath.name);
        }
      });
    }

    let resolvedUsingComponents = {};
    let parseComponents = [];
    let plist = componentKeys.map(name => {
      const url = userDefineComponents[name];

      let prefix = 'path';
      // e.g.
      // plugins://appid/xxxdfdf
      // module:some-3rd-party-component
      let matchs = url.match(/([^:]+):(.+)/);
      let request = url;

      if (matchs) {
        prefix = matchs[1];
        request = matchs[2];
      }

      request = path.isAbsolute(request) ? path.join(process.cwd(), this.options.src, request) : request;

      let target = request;
      let source = request;

      let hookPrefix = 'wepy-parser-config-component-';
      let hookName = prefix;

      if (!this.hasHook(hookPrefix + hookName)) {
        hookName = 'raw';
      }

      return this.hookUnique(hookPrefix + hookName, name, prefix, source, target, chain).then(
        ({ name, resolved, target, npm }) => {
          if (hookName === 'raw') {
            const comChain = this.createComponentChain(url);
            comChain.setPrevious(chain);
            // It will not be make
            comChain.ignore(true);

            if (npm) comChain.self('npm');

            resolvedUsingComponents[name] = url;
            parseComponents.push(comChain);
          } else {
            const comChain = this.createComponentChain(resolved.path);
            comChain.setPrevious(chain);
            let relativePath = path.relative(path.dirname(bead.path), target);
            let parsedPath = path.parse(relativePath);
            let isWepy = parsedPath.ext === this.options.wpyExt;

            if (npm) comChain.self('npm');
            /**
             * Todo: it would be remove later.
             */
            if (isWepy) comChain.self('wepy');

            resolvedUsingComponents[name] = path.join(parsedPath.dir, parsedPath.name);
            parseComponents.push(comChain);
          }
        }
      );
    });

    return Promise.all(plist).then(() => {
      if (isApp) {
        appUsingComponents = parseComponents;
        delete meta.usingComponents;
      } else {
        meta.usingComponents = Object.assign({}, resolvedUsingComponents, appDefinedComponents);
      }

      bead.parsed = {
        code: source,
        components: parseComponents
      };
      return chain;
    });
  });

  // eslint-disable-next-line
  this.register('wepy-parser-config-component-raw', function(name, prefix, source, target, chain) {
    return Promise.resolve({
      name,
      prefix
    });
  });

  this.register('wepy-parser-config-component-module', function(name, prefix, source, target, chain) {
    let contextDir = path.dirname(chain.bead.path);
    return this.resolvers.normal.resolve({}, contextDir, source, {}).then(resolved => {
      return {
        name: name,
        prefix: prefix,
        resolved: resolved,
        target: this.getModuleTarget(resolved.path, this.options.src),
        npm: resolved.meta.descriptionFileRoot !== this.context
      };
    });
  });

  this.register('wepy-parser-config-component-path', function(name, prefix, source, target, chain) {
    const moduleRequest = loaderUtils.urlToRequest(source, source.charAt(0) === '/' ? '' : null);

    let contextDir = path.dirname(chain.bead.path);

    return this.resolvers.normal.resolve({}, contextDir, moduleRequest, {}).then(resolved => {
      return {
        name: name,
        prefix: prefix,
        resolved: resolved,
        target: resolved.path,
        npm: resolved.meta.descriptionFileRoot !== this.context
      };
    });
  });
};
