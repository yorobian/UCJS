// ==UserScript==
// @name        FindAgainScroller.uc.js
// @description Customizes the scroll style on "Find again".
// @include     main
// ==/UserScript==

// @require Util.uc.js
// @note A default function is modified. see FindAgainScroller_init.


(function() {


"use strict";


/**
 * Configurations.
 */
const kConfig = {
  // Align scroll position of the found text.
  // @see AlignPosition() for detail settings.
  alignPosition: true,

  // Scroll to the found text smoothly.
  // @see SmoothScroll() for detail settings.
  smoothScroll: true,

  // Blink the found text.
  // @see FoundBlink() for detail settings.
  foundBlink: true
};


/**
 * Wrapper of gFindBar.
 */
var TextFinder = {
  get text() {
    return gFindBar._findField.value;
  },

  get selectionController() {
    var editable = gFindBar._foundEditable;
    if (editable) {
      try {
        return editable.
          QueryInterface(Ci.nsIDOMNSEditableElement).
          editor.
          selectionController;
      } catch (e) {}
      return null;
    }
    return gFindBar._getSelectionController(gFindBar._currentWindow);
  }
};


/**
 * Main function.
 */
function FindAgainScroller_init() {
  var mScrollObserver = ScrollObserver();

  // Optional functions.
  var mAlignPosition = AlignPosition(kConfig.alignPosition);
  var mSmoothScroll = SmoothScroll(kConfig.smoothScroll);
  var mFoundBlink = FoundBlink(kConfig.foundBlink);

  // Customizes the original function.
  // @modified chrome://global/content/bindings/findbar.xml::onFindAgainCommand
  var $onFindAgainCommand = gFindBar.onFindAgainCommand;
  gFindBar.onFindAgainCommand = function(aFindPrevious) {
    var scrollable = mScrollObserver.attach(TextFinder.text);

    $onFindAgainCommand.apply(this, arguments);

    if (scrollable) {
      if (mAlignPosition && (mAlignPosition.alwaysAlign || mScrollObserver.isScrolled())) {
        mAlignPosition.align(aFindPrevious);
      }
      if (mSmoothScroll && mScrollObserver.isScrolled()) {
        mSmoothScroll.start(mScrollObserver.getScrolled());
      }
    }

    mScrollObserver.detach();

    if (mFoundBlink) {
      mFoundBlink.start();
    }
  };
}


/**
 * Observer of the scrollable elements.
 */
function ScrollObserver() {
  var mScrollable = Scrollable();

  function Scrollable() {
    var mItems = [];
    var mScrolled = null;

    function detach() {
      if (mItems.length) {
        mItems.forEach(function(item) {
          item.node = null;
          item.scroll = null;
        });
        mItems.length = 0;
      }

      if (mScrolled !== null) {
        mScrolled.node = null;
        mScrolled.start = null;
        mScrolled.goal = null;
        mScrolled = null;
      }
    }

    function add(aNode) {
      if (aNode && mItems.every(function(item) item.node !== aNode)) {
        mItems.push({
          node: aNode,
          scroll: getScroll(aNode)
        });
      }
    }

    function getScrolled(aUpdate) {
      if (!aUpdate && mScrolled !== null) {
        return mScrolled;
      }

      mScrolled = null;

      mItems.some(function(item) {
        var now = getScroll(item.node);
        if (now.x !== item.scroll.x || now.y !== item.scroll.y) {
          // @note mScrolled will be the parameter of SmoothScroll()::start().
          // @see SmoothScroll()::start()
          mScrolled = {
            node: item.node,
            start: item.scroll,
            goal: now
          };
          return true;
        }
        return false;
      });

      return mScrolled;
    }

    return {
      get count() mItems.length,
      detach: detach,
      add: add,
      getScrolled: getScrolled
    };
  }

  function attach(aFindText) {
    if (aFindText) {
      scanScrollables(gBrowser.contentWindow, aFindText);
      return mScrollable.count > 0;
    }
    return false;
  }

  function scanScrollables(aWindow, aFindText) {
    if (aWindow.frames) {
      Array.forEach(aWindow.frames, function(frame) {
        scanScrollables(frame, aFindText);
      });
    }

    // Grab <body> or <frameset>.
    var doc = aWindow.contentDocument || aWindow.document;

    // Skip XHTML2 document.
    var body = doc.body;
    if (!body)
      return;

    if (aWindow.scrollMaxX || aWindow.scrollMaxY) {
      mScrollable.add(body);
    }

    var text = aFindText.replace(/\"/g, '&quot;').replace(/\'/g, '&apos;');
    var xpath = 'descendant-or-self::*[contains(normalize-space(),"' + text + '")]|descendant::textarea';
    $X(xpath, body).forEach(function(node) {
      mScrollable.add(testScrollable(node));
    });
  }

  function testScrollable(aNode) {
    var getComputedStyle = getWindow(aNode).getComputedStyle;
    var style;

    while (!(aNode instanceof HTMLHtmlElement)) {
      if (aNode instanceof HTMLElement) {
        style = getComputedStyle(aNode, '');

        if ((/^(?:scroll|auto)$/.test(style.overflowX) && aNode.scrollWidth > aNode.clientWidth) ||
            (/^(?:scroll|auto)$/.test(style.overflowY) && aNode.scrollHeight > aNode.clientHeight) ||
            (aNode instanceof HTMLTextAreaElement && aNode.scrollHeight > aNode.clientHeight)) {
          return aNode;
        }
      }
      aNode = aNode.parentNode;
    }
    return null;
  }

  function getScroll(aNode) {
    var x, y;

    if (aNode instanceof HTMLBodyElement) {
      let win = getWindow(aNode);
      x = win.scrollX;
      y = win.scrollY;
    } else {
      x = aNode.scrollLeft;
      y = aNode.scrollTop;
    }

    return {x: x, y: y};
  }

  function getWindow(aNode) {
    return aNode.ownerDocument.defaultView || gBrowser.contentWindow;
  }


  // Exports.

  return {
    attach: attach,
    detach: mScrollable.detach,
    isScrolled: function() !!mScrollable.getScrolled(true),
    getScrolled: function() mScrollable.getScrolled(false)
  };
}


/**
 * Function for alignment of the found text position.
 */
function AlignPosition(aEnable) {
  const kOption = {
    // How to align the frame of the found text in percentage.
    // -1 means move the frame the minimum amount necessary in order for the entire frame to be visible (if possible).
    vPosition: 50, // (%) 0:top, 50:center, 100:bottom, -1:minimum.
    hPosition: -1, // (%) 0:left, 50:center, 100:right, -1:minimum.

    // true: Reverse the position on 'Find previous' mode.
    reversePositionOnFindPrevious: false,

    // true: Try to align when the match text is found into the current view.
    // false: No scrolling in the same view.
    alwaysAlign: false
  };


  // Export.

  if (aEnable) {
    return {
      get alwaysAlign() kOption.alwaysAlign,
      align: align
    };
  }
  return null;


  // Functions.

  function align(aFindPrevious) {
    var selection = getSelection();

    if (selection) {
      let v = kOption.vPosition, h = kOption.hPosition;

      if (kOption.reversePositionOnFindPrevious && aFindPrevious) {
        if (v > -1) v = 100 - v;
        if (h > -1) h = 100 - h;
      }

      scrollSelection(selection, v, h);
    }
  }

  function getSelection() {
    var selectionController = TextFinder.selectionController;

    return selectionController &&
      selectionController.getSelection(Ci.nsISelectionController.SELECTION_NORMAL);
  }

  function scrollSelection(aSelection, aVPosition, aHPosition) {
    aSelection.
    QueryInterface(Ci.nsISelectionPrivate).
    scrollIntoView(
      Ci.nsISelectionController.SELECTION_ANCHOR_REGION,
      true,
      aVPosition,
      aHPosition
    );
  }
}


/**
 * Function for scrolling the element smoothly.
 */
function SmoothScroll(aEnable) {
  const kOption = {
    // Pitch of the vertical scroll.
    // 8 pitches mean approaching to the goal by each remaining distance divided by 8.
    // far: The goal is out of the current view.
    // near: The goal is into the view.
    pitch: {far: 8, near: 2}
  };

  var mTimerID;
  var mStartTime;

  var mState = {
    init: function(aNode, aStart, aGoal) {
      if (this.goal) {
        this.uninit(true);
      }

      if (typeof aGoal === 'undefined')
        return;

      aNode = aNode || getDocumentElement();

      var scrollable = testScrollable(aNode);
      if (!scrollable)
        return;

      this.view = scrollable.view;
      this.node = aNode;
      this.goal = aGoal;

      startScroll(aStart);
    },

    uninit: function(aForceGoal, aOnScrollStopped) {
      if (!this.goal)
        return;

      if (!aOnScrollStopped) {
        stopScroll(aForceGoal);
      }

      delete this.view;
      delete this.node;
      delete this.goal;
    }
  };


  // Export.

  if (aEnable) {
    return {
      start: function({node, start, goal}) {
        mState.init(node, start, goal);
      },
      stop: function({forceGoal}) {
        mState.uninit(forceGoal);
      }
    };
  }
  return null;


  // Functions.

  function startScroll(aStart) {
    if (aStart) {
      doScrollTo(aStart);
    }

    mStartTime = Date.now();
    doStep(getStep(aStart || getScroll().position), mStartTime);
  }

  function doStep(aStep, aLastTime) {
    var was = getScroll();
    doScrollBy(aStep);
    var now = getScroll();

    var currentTime = Date.now();
    if (currentTime - mStartTime > 1000 || currentTime - aLastTime > 100) {
      stopScroll(true);
    } else if (
      (was.position.x === now.position.x || was.inside.x !== now.inside.x) &&
      (was.position.y === now.position.y || was.inside.y !== now.inside.y)) {
      stopScroll();
    } else {
      mTimerID = setTimeout(doStep, 0, getStep(now.position), currentTime);
    }
  }

  function stopScroll(aForceGoal) {
    if (!mTimerID)
      return;

    clearTimeout(mTimerID);
    mTimerID = null;
    mStartTime = null;

    if (aForceGoal) {
      doScrollTo(mState.goal);
    }

    mState.uninit(false, true);
  }

  function getStep(aPosition) {
    var dX = mState.goal.x - aPosition.x, dY = mState.goal.y - aPosition.y;
    var pitchY = (Math.abs(dY) < mState.node.clientHeight) ? kOption.pitch.far : kOption.pitch.near;

    return Position(round(dX / 2), round(dY / pitchY));
  }

  function round(aValue) {
    if (aValue > 0)
      return Math.ceil(aValue); 
    if (aValue < 0)
      return Math.floor(aValue);
    return 0;
  }

  function getScroll() {
    var x, y;
    if (mState.view) {
      x = mState.view.scrollX;
      y = mState.view.scrollY;
    } else {
      x = mState.node.scrollLeft;
      y = mState.node.scrollTop;
    }

    return {
      position: Position(x, y),
      inside: Position(x < mState.goal.x, y < mState.goal.y)
    };
  }

  function doScrollTo(aPosition) {
    if (mState.view) {
      mState.view.scrollTo(aPosition.x, aPosition.y);
    } else {
      mState.node.scrollLeft = aPosition.x;
      mState.node.scrollTop  = aPosition.y;
    }
  }

  function doScrollBy(aPosition) {
    if (mState.view) {
      mState.view.scrollBy(aPosition.x, aPosition.y);
    } else {
      mState.node.scrollLeft += aPosition.x;
      mState.node.scrollTop  += aPosition.y;
    }
  }

  function testScrollable(aNode) {
    var view = null, scrollable = false;

    if (aNode instanceof HTMLHtmlElement || aNode instanceof HTMLBodyElement) {
      view = getWindow(aNode);
      scrollable = view.scrollMaxX || view.scrollMaxY;
    } else if (aNode instanceof HTMLTextAreaElement) {
      scrollable = aNode.scrollHeight > aNode.clientHeight;
    } else if (aNode instanceof HTMLElement) {
      let style = getWindow(aNode).getComputedStyle(aNode, '');
      scrollable =
        style.overflowX === 'scroll' || style.overflowY === 'scroll' ||
        (style.overflowX === 'auto' && aNode.scrollWidth > aNode.clientWidth) ||
        (style.overflowY === 'auto' && aNode.scrollHeight > aNode.clientHeight);
    }

    return scrollable ? {view: view} : null;
  }

  function getWindow(aNode) {
    return aNode.ownerDocument.defaultView || gBrowser.contentWindow;
  }

  function getDocumentElement() {
    return gBrowser.contentDocument.documentElement;
  }

  function Position(aX, aY) {
    return {x: aX, y: aY};
  }
}


/**
 * Function for blinking the found text.
 */
function FoundBlink(aEnable) {
  const kOption = {
    // Duration of blinking. millisecond.
    duration: 2000,
    // The number of times to blink should be even.
    // 6 steps mean on->off->on->off->on->off->on.
    steps: 6
  };

  var mTimerID;
  var mSelectionController;


  // Export.

  if (aEnable) {
    // Attach a cleaner when the selection is removed by clicking.
    addEvent([gBrowser.mPanelContainer, 'mousedown', uninit, false]);

    return {
      start: start
    };
  }
  return null;


  // Functions.

  function init() {
    uninit();

    var selectionController = TextFinder.selectionController;
    if (selectionController) {
      mSelectionController = selectionController;
      return true;
    }
    return false;
  }

  function uninit() {
    if (mTimerID) {
      clearInterval(mTimerID);
      mTimerID = null;
    }

    if (mSelectionController) {
      mSelectionController = null;
    }
  }

  function start() {
    if (!init())
      return;

    var {duration, steps} = kOption;
    var limits = steps, blinks = 0;
    var range = getRange();

    mTimerID = setInterval(function() {
      // Check whether the selection is into the view within trial limits.
      if (blinks === 0 && limits-- > 0 && !isRangeIntoView(range))
        return;
      // Break when blinks end or trial is expired.
      if (blinks === steps || limits <= 0) {
        uninit();
        return;
      }
      setDisplay(!!(blinks % 2));
      blinks++;
    }, parseInt(duration / steps, 10));
  }

  function isRangeIntoView(aRange) {
    var {top, bottom} = aRange.getBoundingClientRect();

    return 0 <= top && bottom <= window.innerHeight;
  }

  function getRange() {
    return mSelectionController.
      getSelection(Ci.nsISelectionController.SELECTION_NORMAL).
      getRangeAt(0);
  }

  function setDisplay(aShow) {
    try {
      mSelectionController.setDisplaySelection(
        aShow ?
        Ci.nsISelectionController.SELECTION_ATTENTION :
        Ci.nsISelectionController.SELECTION_OFF
      );

      mSelectionController.repaintSelection(Ci.nsISelectionController.SELECTION_NORMAL);
    } catch (e) {}
  }
}


// Imports.

function $X(aXPath, aNode)
  ucjsUtil.getNodesByXPath(aXPath, aNode);

function addEvent(aData)
  ucjsUtil.setEventListener(aData);

function log(aMsg)
  ucjsUtil.logMessage('FindAgainScroller.uc.js', aMsg);


// Entry point.

FindAgainScroller_init();


})();