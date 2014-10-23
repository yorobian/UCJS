// ==UserScript==
// @name TextLink.uc.js
// @description Detects the unlinked URL-like text.
// @include main
// ==/UserScript==

// @require Util.uc.js

/**
 * @usage A new tab will open in the detected URL when 'double-click' on a
 * URL-like text.
 * @note A text will be only selected (by the Fx default behavior) if
 * 'Shift' or 'Ctrl' keys are being pressed.
 */


(function(window, undefined) {


"use strict";


/**
 * Imports
 */
const {
  getFirstNodeByXPath: $X1,
  addEvent,
  openTab
} = window.ucjsUtil;

// For debugging.
function log(aMsg) {
  return window.ucjsUtil.logMessage('TextLink.uc.js', aMsg);
}

/**
 * Helper functions for URL-like strings.
 *
 * @return {hash}
 *   @key guess {function}
 *   @key extract {function}
 *   @key map {function}
 *   @key fix {function}
 *
 * TODO: Detect Kana/Kanji characters.
 */
const URLUtil = (function() {
  /**
   * Converts fullwidth ASCII printable characters into halfwidth ones.
   *
   * @param aString {string}
   * @return {string}
   *
   * [94 characters]
   * !"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`
   * abcdefghijklmnopqrstuvwxyz{|}~
   *
   * [Unicode]
   * Half width: 0x0021-0x007E
   * Full width: 0xFF01-0xFF5E
   *
   * @see http://taken.s101.xrea.com/blog/article.php?id=510
   */
  let normalize = (aString) => aString.replace(/[\uFF01-\uFF5E]/g,
    (aChar) => {
      let code = aChar.charCodeAt(0);
      code &= 0x007F; // FF01->0001
      code += 0x0020;

      return String.fromCharCode(code);
    }
  );

  /**
   * Tests if a string has only ASCII characters.
   *
   * @param aString {string}
   * @return {boolean}
   */
  let isASCII = (aString) => !/[^!-~]/.test(normalize(aString));

  /**
   * Retrieves an array of URL-like strings.
   *
   * @param aString {string}
   * @return {array|null}
   *   |null| if no matches.
   */
  let match = (function() {
    const absolute =
      '(?:ps?:\\/\\/|www\\.)(?:[\\w\\-]+\\.)+[a-z]{2,}[!-~]*';
    const relative =
      '\\.\\.?\\/[!-~]+';

    const re = RegExp(absolute + '|' + relative, 'ig');

    return (aString) => normalize(aString).match(re);
  })();

  /**
   * Tests if a selection text has only ASCII characters.
   *
   * @param aSelection {nsISelection}
   * @return {boolean}
   *
   * @note Guesses the selection string at a part of a URL.
   */
  function guess(aSelection) {
    return isASCII(aSelection.toString());
  }

  /**
   * Extracts an array of URL-like strings from a range text.
   *
   * @param aRange {nsIDOMRange}
   * @return {array|null}
   *   |null| if no matches.
   */
  function extract(aRange) {
    return match(encodeToPlain(aRange));
  }

  /**
   * Gets a text that its fullwidth ASCII characters are converted into
   * halfwidth.
   *
   * @param aRange {nsIDOMRange}
   * @return {string}
   *
   * @note Used as a map indicating the position of URL strings.
   */
  function map(aRange) {
    return normalize(aRange.toString());
  }

  /**
   * Makes a good URL.
   *
   * @param aString {string}
   * @return {string}
   */
  function fix(aString) {
    return aString.
      replace(/^[^s:\/]+(s?:\/)/, 'http$1').
      replace(/^www\./, 'http://www.').
      // Remove trailing characters that may be marks unrelated to the URL.
      replace(/["')\]]*[,.;:]*$/, '');
  }

  return {
    guess,
    extract,
    map,
    fix
  }
})();

function TextLink_init() {
  addEvent(gBrowser.mPanelContainer, 'dblclick', handleEvent, false);
}

function handleEvent(aEvent) {
  // Bail out for the selection by the default action.
  if (aEvent.shiftKey || aEvent.ctrlKey) {
    return;
  }

  let doc = aEvent.originalTarget.ownerDocument;

  if (!isTextDocument(doc)) {
    return;
  }

  let selection = doc.defaultView.getSelection();

  let URL = findURL(doc, selection);

  if (URL) {
    selection.removeAllRanges();

    openTab(URL, {
      relatedToCurrent: true
    });
  }
}

function findURL(aDocument, aSelection) {
  let URL = '';

  // Test if the selection seems to be a part of a URL.
  if (!aSelection ||
      !aSelection.rangeCount ||
      !URLUtil.guess(aSelection)) {
    return URL;
  }

  // Make a target range with a source selection.
  let range = aDocument.createRange();

  range.selectNode(aDocument.documentElement);

  // Update the target range and get the position of the source selection
  // in the target range.
  let position = initRange(range, aSelection.getRangeAt(0));

  // Extract an array of URL strings.
  let URLs = URLUtil.extract(range);

  if (!URLs) {
    return URL;
  }

  // Scan the position of a URL in the target range.
  let map = URLUtil.map(range);
  let start, end = 0;

  URLs.some((url) => {
    start = map.indexOf(url, end);
    end = start + url.length;

    // Got it if the URL contains the source selection.
    if (position.start < end && start < position.end) {
      URL = URLUtil.fix(url);
      return true;
    }
    return false;
  });

  return URL;
}

function initRange(aRange, aSourceRange) {
  function expand(aXPath, aNode, aCount) {
    // The threshold number of characters without white-spaces.
    // @note It seems that 2,000 characters are sufficient for a HTTP URL.
    const kMaxTextLength = 2000;

    let node = aNode;
    let border = node;
    let count = aCount;
    let text;

    while (count < kMaxTextLength) {
      node = $X1(aXPath, node);

      if (!node) {
        break;
      }

      border = node;
      text = node.textContent;
      count += text.length;

      // A white-space marks off the URL string.
      if (/\s/.test(text)) {
        break;
      }
    }

    return {
      border,
      count
    };
  }

  // Expand range before the source selection.
  let result = expand(
    'preceding::text()[1]',
    aSourceRange.startContainer,
    aSourceRange.startOffset
  );

  aRange.setStartBefore(result.border);

  // Store the source position.
  let start = result.count;
  let end = start + aSourceRange.toString().length;

  // Expand range after the source selection.
  result = expand(
    'following::text()[1]',
    aSourceRange.endContainer,
    aSourceRange.endContainer.textContent.length - aSourceRange.endOffset
  );

  aRange.setEndAfter(result.border);

  return {
    start,
    end
  };
}

function encodeToPlain(aRange) {
  let encoder =
    Cc['@mozilla.org/layout/documentEncoder;1?type=text/plain'].
    createInstance(Ci.nsIDocumentEncoder);

  encoder.init(
    aRange.startContainer.ownerDocument,
    'text/plain',
    encoder.OutputLFLineBreak |
    encoder.SkipInvisibleContent
  );

  encoder.setRange(aRange);

  return encoder.encodeToString();
}

function isTextDocument(aDocument) {
  // @see chrome://browser/content/browser.js::mimeTypeIsTextBased
  return aDocument && window.mimeTypeIsTextBased(aDocument.contentType);
}

/**
 * Entry point.
 */
TextLink_init();


})(this);
