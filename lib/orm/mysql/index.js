var mysql  = require('mysql');
var errors = require('../../errors/errors');

var ezmysql = module.exports = {
  pool         : null,
  debug        : false,
  connect      : function (connStrJson) {
    if (this.debug) {
      console.log('Connecting to MySQL...', connStrJson);
    }
    this.pool  = mysql.createPool(connStrJson);
    this.debug = process.env.debug;
  },
  query        : function (sql, params) {
    if (!this.pool) {
      throw errors.CUSTOM('pool 参数尚未初始化，请执行启动应用的时候执行 connect 方法');
    }
    if (this.debug) {
      console.log("------------", new Date(), "----------------------------");
      console.log("sql: ", sql);
      console.log("params: ", params);
      console.log("----------------------------------------");
    }
    return function (callback) {
      ezmysql.pool.query(sql, params, function (err, rows, fields) {
        if (err) {
          callback(err);
        } else {
          callback(null, rows);
        }
      });
    }
  },
  //conditions 可以支持如下： skip, limit, orderBy, where, params, cols
  list         : function *(table, conditions) {
    conditions = conditions || {};
    if (!conditions.cols) {
      conditions.cols = '*';
    }
    if (!conditions.skip) {
      conditions.skip = 0;
    }
    if (!conditions.limit) {
      conditions.limit = 5;
    }
    if (!conditions.where) {
      conditions.where = "1=1"
    }
    if (conditions.orderBy) {
      conditions.orderBy = 'order by ' + conditions.orderBy;
    } else {
      conditions.orderBy = '';
    }
    table   = "`" + table + "`";
    var sql = `select ${conditions.cols} from ${table} where ${conditions.where} ${conditions.orderBy} limit ${conditions.limit} offset ${conditions.skip}`;
    return yield ezmysql.query(sql, conditions.params);
    //var cql  = `select count(*) as ct from ${table} where ${conditions.where} `;
    //var rows = yield ezmysql.query(sql, conditions.params);
    //var cts  = yield ezmysql.query(cql, conditions.params);
    //return {total: cts[0].ct, data: rows};
  },
  insert       : function *(table, model) {
    table      = "`" + table + "`";
    var sql    = `insert into ${table} set ?`;
    var result = yield ezmysql.query(sql, model);
    if (result.affectedRows >= 1) {
      return {id: result.insertId};
    }
    throw errors.CUSTOM("插入失败。");
  },
  update       : function *(table, model) {
    if (!model.hasOwnProperty('id')) {
      throw errors.WHAT_REQUIRE('id');
    }
    var id  = model.id;
    table   = "`" + table + "`";
    var sql = `update ${table} set ? where ?`;
    delete  model.id;
    var result = yield ezmysql.query(sql, [model, {id: id}]);
    if (result.changedRows) {
      return true;
    }
    throw errors.CUSTOM("没有数据被更新。");
  },
  updateBatch  : function *(table, model, conditions) {
    if (model.hasOwnProperty('id')) {
      throw errors.CUSTOM('id 不能被修改。');
    }
    if (!conditions || !conditions.where) {
      throw errors.CUSTOM('批量修改必须有 {where: xxx, params:xxx}。');
    }
    table      = "`" + table + "`";
    var sql    = `update ${table} set ? where ${conditions.where}`;
    var result = yield ezmysql.query(sql, [model, conditions.params]);
    if (result.changedRows) {
      return true;
    }
    throw errors.CUSTOM("更新失败，没有符合条件的数据。");
  },
  load         : function *(table, conditions) {
    conditions       = conditions || {};
    conditions.where = conditions.where || "1=1";
    conditions.limit = 1;
    conditions.cols  = conditions.cols || '*';
    table            = "`" + table + "`";
    var sql          = `select ${conditions.cols} from ${table} where ${conditions.where} limit ${conditions.limit}`;
    var rows         = yield ezmysql.query(sql, conditions.params);
    if (rows.length > 0) {
      return rows[0];
    }
    return null;
  },
  loadByKV     : function *(table, key, value) {
    return yield ezmysql.load(table, {
      where : key + " = ?",
      params: [value]
    });
  },
  loadById     : function *(table, id) {
    return yield ezmysql.loadByKV(table, "id", id);
  },
  delete       : function *(table, conditions) {
    conditions       = conditions || {};
    conditions.where = conditions.where || "1=2";
    table            = "`" + table + "`";
    var sql          = `delete from ${table} where ${conditions.where}`;
    var result       = yield ezmysql.query(sql, conditions.params);
    return (result.changedRows > 0);
  }
  ,
  count        : function *(table, conditions) {
    conditions       = conditions || {};
    conditions.where = conditions.where || "1=1";
    table            = "`" + table + "`";
    var sql          = `select count(*) as ct from ${table} where ${conditions.where} `;
    var rows         = yield ezmysql.query(sql, conditions.params);
    if (rows.length > 0) {
      return rows[0].ct;
    }
    return 0;
  }
  ,
  sum          : function *(table, conditions) {
    conditions       = conditions || {};
    conditions.where = conditions.where || "1=1";
    table            = "`" + table + "`";
    var sql          = `select sum(${conditions.col}) as ct from ${table} where ${conditions.where} `;
    var rows         = yield ezmysql.query(sql, conditions.params);
    if (rows.length > 0) {
      return rows[0].ct;
    }
    return 0;
  }
  ,
  /**
   * 这是一个 koa 插件， 使用此插件后, 可以直接在浏览器中通过组装 URL 实现 MySQL 文档的曾删改查操作。
   * url 的组装方式是 {method: 'list', table: xx, conditions: ...} 变成字符串, 然后使用 base64 编码. 比如: 编码后的文件是 base64String
   * 入口文件是: /crud?base64String
   * @param next
   * ```
   *
   * ```
   */
  koaMiddleware: function *(next) {
    var rUrl          = this.url;
    var pathJson      = require("url").parse(rUrl);
    var pathname      = pathJson.pathname.toLowerCase();
    var pathnameArray = pathname.split('/');
    if (pathnameArray[1] !== 'crud') {
      yield next;
    } else {
      var query  = new Buffer(pathJson.query, 'base64').toString('utf-8');
      var jQuery = JSON.parse(query);
      if (!jQuery.hasOwnProperty('table')) {
        throw errors.WHAT_REQUIRE('table');
      }
      if (!jQuery.hasOwnProperty('method')) {
        throw errors.WHAT_REQUIRE('method');
      }
      if (!jQuery.conditions) {
        jQuery.conditions = {};
      }
      switch (this.method) {
        case 'POST':
          var model = this.request.body;
          this.body = yield ezmysql[jQuery.method](jQuery.table, model, jQuery.conditions);
          break;
        default:
          var data = yield ezmysql[jQuery.method](jQuery.table, jQuery.conditions);
          var res  = {errno: 0, data: data};
          if (jQuery.method === 'list') {
            res.total = yield ezmysql.count(jQuery.table, jQuery.conditions);
            res.count = data.length;
            res.skip  = jQuery.conditions.skip || 0;
            res.limit = jQuery.conditions.limit || 5;
          }
          this.body = res;
          break;
      }
    }
  }
};