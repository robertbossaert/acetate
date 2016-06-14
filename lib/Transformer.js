const minimatch = require('minimatch');
const async = require('async');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const _ = require('lodash');
const createPage = require('./createPage.js');
const Logger = require('./Logger');

class Transformer {
  constructor ({
    sourceDir = path.join(process.cwd(), 'src'),
    logger,
    logLevel = 'info'
  } = {}) {
    this._transformers = [];
    this.sourceDir = sourceDir;
    this.logger = logger || new Logger({level: logLevel});
  }

  reset () {
    this._transformers = [];
  }

  /**
   * function transformer (page) {
   *   // do something;
   *   return page;
   * }
   */
  transform (pattern, transformer) {
    this._transformers.push((pages, done) => {
      async.map(pages, (page, callback) => {
        if (minimatch(page.src, pattern)) {
          try {
            var newPage = transformer(page);
          } catch (e) {
            var error = e;
          }

          process.nextTick(() => {
            callback(error, newPage);
          });

          return;
        }

        process.nextTick(() => {
          callback(null, page);
        });
      }, done);
    });
  }

  /**
   * function transformer (page, callback) {
   *   // do something;
   *   callback(error, page);
   * }
   */
  transformAsync (pattern, transformer) {
    this._transformers.push((pages, done) => {
      async.map(pages, (page, callback) => {
        if (minimatch(page.src, pattern)) {
          try {
            transformer(page, callback);
          } catch (e) {
            callback(e);
          }
          return;
        }

        callback(null, page);
      }, done);
    });
  }

  /**
   * function transformer (pages, callback) {
   *   // do something;
   *   callback(error, pages);
   * }
   */
  transformAll (transformer) {
    this._transformers.push((pages, done) => {
      try {
        var newPages = transformer(pages);
      } catch (e) {
        var error = e;
      }

      process.nextTick(() => {
        done(error, newPages);
      });
    });
  }

  /**
   * function transformer (pages, callback) {
   *   // do something;
   *   callback(error, pages);
   * }
   */
  transformAllAsync (transformer) {
    this._transformers.push((pages, done) => {
      try {
        transformer(pages, done);
      } catch (e) {
        done(e);
      }
    });
  }

  generate (generator) {
    this._transformers.push((pages, done) => {
      try {
        generator(pages, createPage, (error, newPages) => {
          if (error) {
            done(error);
            return;
          }

          done(error, pages.concat(newPages));
        });
      } catch (e) {
        done(e);
      }
    });
  }

  metadata (pattern, data) {
    this.transform(pattern, function (page) {
      return Object.assign(page, data, page.__metadata);
    });
  }

  layout (pattern, layout) {
    this.metadata(pattern, {
      layout
    });
  }

  ignore (pattern) {
    this.metadata(pattern, {
      ignore: true
    });
  }

  data (name, data) {
    if (typeof data === 'function') {
      this._loadDataFromFunction(name, data);
      return;
    }

    this._loadDataFromFile(name, data);
  }

  query (
    name,
    pattern = '**/*',
    mapper = function (page) { return page; },
    reducer = function (result, p) { result.push(p); return result; },
    inital = []
  ) {
    function matcher (page) {
      return minimatch(page.src, pattern);
    }

    var results;

    this.transformAll(function (pages) {
      if (!results) {
        results = _(_.cloneDeep(pages))
          .filter(matcher)
          .map(mapper)
          .compact()
          .reduce(reducer, inital);
      }

      return pages.map(function (page) {
        page.queries = page.queries || {};
        page.queries[name] = results;
        return page;
      });
    });
  }

  _loadDataFromFunction (name, getData) {
    this.transformAllAsync((pages, done) => {
      getData((error, data) => {
        if (error) {
          done(error);
          return;
        }

        pages.forEach((page) => {
          page.data = page.data || {};
          page.data[name] = data;
        });

        done(null, pages);
      });
    });
  }

  _loadDataFromFile (name, datafile) {
    const datapath = path.join(this.sourceDir, datafile);

    this.transformAllAsync((pages, done) => {
      fs.readFile(datapath, 'utf8', function (error, content) {
        if (error) {
          done(error);
          return;
        }

        const ext = path.extname(datapath);
        let data;

        if (ext === '.json') {
          data = JSON.parse(content);
        }

        if (ext === '.yaml' || ext === '.yml') {
          data = yaml.safeLoad(content);
        }

        pages.forEach((page) => {
          page.data = page.data || {};
          page.data[name] = data;
        });

        done(null, pages);
      });
    });
  }

  transformPages (pages) {
    const _masterTimer = this.logger.time();

    return new Promise((resolve, reject) => {
      const done = (error, pages) => {
        if (error) {
          this.logger.error(error);
          reject(error);
          return;
        }

        this.logger.info(`Transformed ${pages.length} pages in ${this.logger.timeEnd(_masterTimer)}`);

        resolve(pages);
      };

      const iterator = (pages, transformer, callback) => {
        transformer(pages, callback);
      };

      async.reduce(this._transformers, pages, iterator, done);
    });
  }
}

module.exports = Transformer;