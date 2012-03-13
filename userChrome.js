// ==UserScript==
// @name userChrome.js
// @description User-script loader for userChrome.js extention.
// ==/UserScript==

// @note Extends property in global scope. See kSystem.loaderName
// @note cf. http://userchromejs.mozdev.org/
// @note cf. https://github.com/alice0775/userChrome.js/blob/master/userChrome.js


(function(window, undefined) {


"use strict";


// ***** Generic variables.

const {document} = window;


// ***** Preferences.

/**
 * User configurations.
 */
const kConfig = {
  // Script sub-folders under your chrome folder.
  // Adding '/' at the end, scripts are scanned in the descendant directories.
  scriptFolders: ['UCJS_files', 'UCJS_tmp/'],

  // File extensions to select which of java-script or xul-overlay the script runs as.
  // Tests exact match from the first dot(.) of a file name.
  jscriptExts: ['.uc.js'],
  overlayExts: ['.uc.xul', '.xul'],

  // URL list of chrome XUL which is blocked to load scripts.
  // Wildcard '*' is available.
  blockXULs: [
    'chrome://global/content/commonDialog.xul',
    'chrome://browser/content/preferences/*',
    'chrome://inspector/*',
    'chrome://adblockplus/*',
    'chrome://noscript/*',
    'chrome://securelogin/*'
  ]
};

/**
 * System configs.
 */
const kSystem = {
  // Required lowest version of Firefox.
  firefoxVersion: '4.0',

  // Global property name in window.
  loaderName: 'ucjsScriptLoader',

  // ID of <overlay> for overlayed scripts.
  overlayContainerID: 'userChrome_js_overlay',

  // Timing to validate the modified time of a script
  // in order to update the startup cache of Firefox.
  // @value {boolean}
  //   true Always when the script runs.
  //   false Only when the script is first scanned.
  validateScriptAtRun: false
};



//***** Entry point.

// Common utility and logging functions.
var Util = Util(), Log = Log(false);

ucjsScriptLoader_init();


//***** Modules.

function ucjsScriptLoader_init() {
  var scriptLoader = ScriptLoader();

  if (scriptLoader.init()) {
    // Extends property in global scope.
    let scriptList = scriptLoader.getScriptList();
    if (scriptList) {
      window[kSystem.loaderName] = {scriptList: scriptList};
    }

    window.addEventListener('unload', function onUnload() {
      window.removeEventListener('unload', onUnload, false);
      scriptLoader.uninit();
    }, false);
  } else {
    scriptLoader.uninit();
  }
}


/**
 * ScriptLoader handler.
 * @return {hash}
 *   @member init {function}
 *   @member uninit {function}
 *   @member getScriptList {function}
 */
function ScriptLoader() {
  var mScriptList = ScriptList();

  function uninit() {
    mScriptList.uninit();
    mScriptList = null;
  }

  function init() {
    const {checkVersion} = Util;

    if (!checkVersion(kSystem.firefoxVersion)) {
      Log.list('Not init window', {
        'Required': 'Firefox %VER% or higher.'.replace('%VER%', kSystem.firefoxVersion)
      });
      return false;
    }
    if (isBlockURL(document)) {
      Log.list('Not init window', {
        'Blocked URL': document.location.href
      });
      return false;
    }
    Log.list('Init window', {
      'URL': document.location.href,
      'Title': (window.content || window).document.title
    });

    mScriptList.init();
    mScriptList.run(document);
    if (inBrowserWindow()) {
      watchSidebar();
    }
    return true;
  }

  function watchSidebar() {
    document.addEventListener('load', initSidebar, true);
    window.addEventListener('unload', function onUnload() {
      document.removeEventListener('load', initSidebar, true);
      window.removeEventListener('unload', onUnload, false);
    }, false);

    function initSidebar(aEvent) {
      var target = aEvent.originalTarget;
      if (!(target instanceof XULDocument)) {
        /* noisy, comment out.
        Log.list('Not init sidebar', {
          'Loaded node': target.nodeName
        });
        */
        return;
      }
      if (isBlockURL(target)) {
        Log.list('Not init sidebar', {
          'Blocked URL': target.location.href
        });
        return;
      }
      Log.list('Init sidebar', {
        'URL': target.location.href,
        'Title': document.getElementById('sidebar-title').value
      });

      mScriptList.run(target);
    }
  }

  function getScriptList() {
    if (inBrowserWindow()) {
      return mScriptList.get();
    }
    return null;
  }

  function inBrowserWindow() {
    const {getBrowserURL} = Util;

    return window.location.href === getBrowserURL();
  }

  function isBlockURL({location}) {
    const {testURL} = Util;

    var URL = location.href;
    return !/^chrome:.+\.xul$/i.test(URL) || kConfig.blockXULs.some(function(s) testURL(s, URL));
  }

  // Exports.
  return {
    init: init,
    uninit: uninit,
    getScriptList: getScriptList
  };
}


/**
 * ScriptList handler.
 * @return {hash}
 *   @member init {function}
 *   @member uninit {function}
 *   @member get {function}
 *   @member run {function}
 */
function ScriptList() {
  var mJscripts, mOverlays;

  function uninit() {
    mJscripts = null;
    mOverlays = null;
  }

  function init() {
    const {getTopBrowserWindow} = Util;

    var win = getTopBrowserWindow();
    var loader = win ? win[kSystem.loaderName] : null;
    if (loader) {
      copyData(loader.scriptList);
      Log.list('Copy script data from', {
        'URL': win.location.href,
        'Title': (win.content || win).document.title
      });
    } else {
      scanData();
    }
  }

  function getData() {
    return {
      jscripts: mJscripts,
      overlays: mOverlays
    };
  }

  function copyData(aData) {
    // Reference copy.
    mJscripts = aData.jscripts;
    mOverlays = aData.overlays;
  }

  function scanData() {
    const log = Log.counter('Scan');
    const {getChromeDirectory, getEntryList, getNextEntry} = Util;

    mJscripts = [];
    mOverlays = [];

    var chrome = getChromeDirectory();
    kConfig.scriptFolders.forEach(function(a) {
      var segments = a.split('/');
      if (segments.length < 3 && segments[0] && !segments[1]) {
        let directory = chrome.clone();
        directory.append(segments[0]);
        if (directory.exists()) {
          scanDirectory(directory, segments[1] === '');
        }
      }
    });

    function scanDirectory(aDirectory, aDeeper) {
      var list = getEntryList(aDirectory), entry;
      var ext, script;
      while ((entry = getNextEntry(list))) {
        if (entry.isHidden())
          continue;
        if (aDeeper && entry.isDirectory()) {
          // Recursively.
          scanDirectory(entry, aDeeper);
        } else if (entry.isFile()) {
          ext = checkExt(entry);
          if (ext) {
            // Don't forget 'new'.
            script = new UserScript(entry);
            if (ext === 'js') {
              mJscripts.push(script);
            } else {
              mOverlays.push(script);
            }
            log(script.getURL('IN_CHROME'));
          }
        }
      }
    }

    function checkExt(aFile) {
      var dot = aFile.leafName.indexOf('.');
      if (dot > -1) {
        let ext = aFile.leafName.substr(dot);
        if (kConfig.jscriptExts.indexOf(ext) > -1)
          return 'js';
        if (kConfig.overlayExts.indexOf(ext) > -1)
          return 'xul';
      }
      return '';
    }
  }

  function runData(aDocument) {
    // Ensure that scripts will run at the end of loader.
    setTimeout(function(doc) {
      setTimeout(runJscripts, 0, doc);
      setTimeout(runOverlays, 0, doc);
    }, 0, aDocument);
  }

  function runJscripts(aDocument) {
    const log = Log.counter('Run JS');
    const {loadJscript} = Util;

    var URL = aDocument.location.href;
    mJscripts.forEach(function(script) {
      if (script.testTarget(URL)) {
        log(script.getURL('IN_CHROME'));
        loadJscript(script.getURL('RUN'), aDocument);
      }
    });
  }

  function runOverlays(aDocument) {
    const log = Log.counter('Run XUL');
    const {loadOverlay} = Util;

    const XUL = '<?xul-overlay href="%URL%"?>';
    const DATA = [
      'data:application/vnd.mozilla.xul+xml;charset=utf-8,',
      '<?xml version="1.0"?>',
      '%XULS%',
      '<overlay id="%ID%"',
      ' xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul"',
      ' xmlns:html="http://www.w3.org/1999/xhtml">',
      '</overlay>'
    ].join('').replace('%ID%', kSystem.overlayContainerID);

    var URL = aDocument.location.href;
    var xuls = '';
    mOverlays.forEach(function(script) {
      if (script.testTarget(URL)) {
        log(script.getURL('IN_CHROME'));
        xuls += XUL.replace('%URL%', script.getURL('RUN'));
      }
    });
    if (xuls) {
      loadOverlay(DATA.replace('%XULS%', xuls), aDocument);
    }
  }


  /**
   * UserScript class.
   */
  function UserScript() {
    this.init.apply(this, arguments);
  }

  UserScript.prototype.file = null;
  UserScript.prototype.meta = null;

  UserScript.prototype.init = function UserScript_init(aFile) {
    this.file = aFile;
    this.meta = scanMetaData(aFile);
  };

  UserScript.prototype.uninit = function UserScript_uninit() {
    delete this.file;
    delete this.meta;
  };

  UserScript.prototype.getURL = function UserScript_getURL(aType) {
    const {getURLSpecFromFile, getChromeDirectory, getLastModifiedTime} = Util;
    const D = window.decodeURIComponent;

    var file = this.file;
    function path() getURLSpecFromFile(file);
    function chrome() getURLSpecFromFile(getChromeDirectory());

    switch (aType) {
      case 'FILENAME':
        return file.leafName;
      case 'FOLDER':
        return D(path()).slice(D(chrome()).length, -(file.leafName.length));
      case 'IN_CHROME':
        return D(path().slice(chrome().length));
      case 'RUN':
        return path() + '?' +
          (kSystem.validateScriptAtRun ? getLastModifiedTime(file) : file.lastModifiedTime);
    }
    return D(path());
  };

  UserScript.prototype.testTarget = function UserScript_testTarget(aURL) {
    return MetaData_isIncludedURL(this.meta, aURL);
  };

  UserScript.prototype.getMetaList = function UserScript_getMetaList() {
    return MetaData_getList(this.meta);
  };


  /**
   * MetaData handlers.
   */
  function scanMetaData(aFile) {
    const {readFile} = Util;

    const META_DATA_RE = /^\s*\/\/\s*==UserScript==\s*\n(?:.*\n)*?\s*\/\/\s*==\/UserScript==\s*\n/m;
    const META_ENTRY_RE = /^\s*\/\/\s*@([\w-]+)\s+(.+?)\s*$/gm;

    var data = {
      'name': [],
      'description': [],
      'include': [],
      'exclude': []
    };

    var meta = (readFile(aFile).match(META_DATA_RE) || [''])[0];
    var matches, key, value;
    while ((matches = META_ENTRY_RE.exec(meta))) {
      [, key, value] = matches;
      if (key in data) {
        data[key].push(value);
      }
    }

    return data;
  }

  function MetaData_isIncludedURL(aMetaData, aURL) {
    const {getBrowserURL, testURL} = Util;

    var browserURL = getBrowserURL();

    function test(s) testURL(s.replace(/^main$/i, browserURL), aURL);

    var exclude = aMetaData.exclude;
    if (exclude.length && exclude.some(test))
      return false;

    var include = aMetaData.include;
    if (!include.length) {
      include[0] = browserURL;
    }
    return include.some(test);
  }

  function MetaData_getList(aMetaData) {
    const kForm = '@%key%: %value%',
          kNoMetaData = '[No meta data]';

    var list = [];
    for (let [key, values] in Iterator(aMetaData)) {
      list = list.concat(values.map(function(v) kForm.replace('%key%', key).replace('%value%', v)));
    }
    return list.length ? list.join('\n') : kNoMetaData;
  }


  // Export.
  return {
    init: init,
    uninit: uninit,
    get: getData,
    run: runData
  };
}


/**
 * Common utilitiy function.
 * @return {hash} Functions.
 */
function Util() {
  const {classes: Cc, interfaces: Ci} = Components;

  function $S(aCID, aIID) Cc[aCID].getService(Ci[aIID]);
  function $I(aCID, aIID) Cc[aCID].createInstance(Ci[aIID]);
  function QI(aNode, aIID) aNode.QueryInterface(Ci[aIID]);

  function getLastModifiedTime(aFile) {
    var lf = $I('@mozilla.org/file/local;1', 'nsILocalFile');

    try {
      lf.initWithPath(aFile.path);
      return lf.lastModifiedTime;
    } catch (e) {}
    return '';
  }

  function readFile(aFile) {
    var fis = $I('@mozilla.org/network/file-input-stream;1', 'nsIFileInputStream');
    var cis = $I('@mozilla.org/intl/converter-input-stream;1', 'nsIConverterInputStream');
    var data = {}, size;

    try {
      fis.init(aFile, 0x01, 0, 0);
      size = fis.available();
      cis.init(fis, 'UTF-8', size, cis.DEFAULT_REPLACEMENT_CHARACTER);
      cis.readString(size, data);
    } finally {
      cis.close();
      fis.close();
    }

    // Set line-breaks in LF.
    return data.value.replace(/\r\n?/g, '\n');
  }

  function checkVersion(aVersion) {
    const xai = $S('@mozilla.org/xre/app-info;1', 'nsIXULAppInfo');
    const vc = $S('@mozilla.org/xpcom/version-comparator;1', 'nsIVersionComparator');

    return xai.name === 'Firefox' && vc.compare(xai.version, String(aVersion)) >= 0;
  }

  // Your chrome directory.
  function getChromeDirectory() {
    return $S('@mozilla.org/file/directory_service;1', 'nsIProperties').
      get('UChrm', Ci['nsIFile']);
  }

  function getEntryList(aDirectory) {
    return QI(aDirectory.directoryEntries, 'nsISimpleEnumerator');
  }

  function getNextEntry(aList) {
    return aList.hasMoreElements() && QI(aList.getNext(), 'nsIFile');
  }

  function getTopBrowserWindow() {
    return $S('@mozilla.org/browser/browserglue;1', 'nsIBrowserGlue').
      getMostRecentBrowserWindow();
  }

  function getURLSpecFromFile(aFile) {
    const ios = $S('@mozilla.org/network/io-service;1', 'nsIIOService');

    return QI(ios.getProtocolHandler('file'), 'nsIFileProtocolHandler').
      getURLSpecFromFile(aFile);
  }

  function loadJscript(aPath, aDocument) {
    $S('@mozilla.org/moz/jssubscript-loader;1', 'mozIJSSubScriptLoader').
    loadSubScript(aPath, aDocument.defaultView);
  }

  function loadOverlay(aData, aDocument) {
    aDocument.loadOverlay(aData, null);
  }

  function getBrowserURL() {
    return 'chrome://browser/content/browser.xul';
  }

  function testURL(aSource, aURL) {
    return RegExp('^' + aSource.replace(/\W/g, '\\$&').replace(/\\\*/g, '.*?') + '$').test(aURL);
  }

  return {
    getLastModifiedTime: getLastModifiedTime,
    readFile: readFile,
    checkVersion: checkVersion,
    getChromeDirectory: getChromeDirectory,
    getEntryList: getEntryList,
    getNextEntry: getNextEntry,
    getTopBrowserWindow: getTopBrowserWindow,
    getURLSpecFromFile: getURLSpecFromFile,
    loadJscript: loadJscript,
    loadOverlay: loadOverlay,
    getBrowserURL: getBrowserURL,
    testURL: testURL
  };

}


/**
 * Logging function.
 * @param aEnabled {boolean} Whether logging is enabled or not.
 * @return {hash} Functions.
 */
function Log(aEnabled) {
  function msg(aValue, aDepth) {
    var indent = aDepth ? Array(aDepth + 1).join(' ') + '+- ' : '';

    if (Array.isArray(aValue)) {
      log(indent + aValue.toSource());
    } else if (typeof aValue === 'object') {
      for (let key in aValue) {
        log(indent + key + ': ' + aValue[key]);
      }
    } else {
      log(indent + aValue.toString());
    }
  }

  function list(aCaption) {
    log(format('%caption% -----', {'caption': aCaption}));

    Array.forEach(arguments, function(a, i) {
      0 < i && this.msg(a, i);
    }, this);
  }

  function counter(aHeader) {
    var form = format('%header%: %count%. %value%', {'header': aHeader});
    var count = 0;

    return function(aValue) {
      log(format(form, {'count': ++count, 'value': aValue}));
    }
  }

  function format(aForm, aAttribute) {
    for (let [name, value] in Iterator(aAttribute)) {
      aForm = aForm.replace('%' + name + '%', String(value));
    }
    return aForm;
  }

  function log(aMsg) {
    Application.console.log('[' + kSystem.loaderName + '] ' + aMsg);
  }

  function empty() function(){};

  return aEnabled ?
    {msg: msg, list: list, counter: counter} :
    {msg: empty, list: empty, counter: empty};
}


})(this);