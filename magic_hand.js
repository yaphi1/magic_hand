const OPTIONS = {
  IS_DEBUG_MODE: false,
  PREFERRED_HAND: 'right', /* change to 'left' if you want */
  PINCH_DELAY_MS: 60,
};

const state = {
  isPinched: false,
  pinchChangeTimeout: null,
  grabbedElement: null,
  lastGrabbedElement: null,
};

const PINCH_EVENTS = {
  START: 'pinch_start',
  MOVE: 'pinch_move',
  STOP: 'pinch_stop',
  PICK_UP: 'pinch_pick_up',
  DROP: 'pinch_drop',
};

function triggerEvent({ eventName, eventData }) {
  const event = new CustomEvent(eventName, { detail: eventData });
  document.dispatchEvent(event);
}

const videoElement = document.querySelector('.input_video');
const debugCanvas = document.querySelector('.output_canvas');
const debugCanvasCtx = debugCanvas.getContext('2d');

const cursor = document.querySelector('.cursor');
const movableElements = [
  ...document.querySelectorAll('.movable'),
];

const handParts = {
  wrist: 0,
  thumb: { base: 1, middle: 2, topKnuckle: 3, tip: 4 },
  indexFinger: { base: 5, middle: 6, topKnuckle: 7, tip: 8 },
  middleFinger: { base: 9, middle: 10, topKnuckle: 11, tip: 12 },
  ringFinger: { base: 13, middle: 14, topKnuckle: 15, tip: 16 },
  pinky: { base: 17, middle: 18, topKnuckle: 19, tip: 20 },
};

function getElementCoords(element) {
  const rect = element.getBoundingClientRect();
  const elementTop = rect.top / window.innerHeight;
  const elementBottom = rect.bottom / window.innerHeight;
  const elementLeft = rect.left / window.innerWidth;
  const elementRight = rect.right / window.innerWidth;
  return { elementTop, elementBottom, elementLeft, elementRight };
};

function isElementPinched({ pinchX, pinchY, elementTop, elementBottom, elementLeft, elementRight }) {
  const isPinchInXRange = elementLeft <= pinchX && pinchX <= elementRight;
  const isPinchInYRange = elementTop <= pinchY && pinchY <= elementBottom;
  return isPinchInXRange && isPinchInYRange;
};

function getPinchedElement({ pinchX, pinchY, elements }) {
  let grabbedElement;
  for (const element of elements) {
    const elementCoords = getElementCoords(element);
    if (isElementPinched({ pinchX, pinchY, ...elementCoords })) {
      grabbedElement = {
        domNode: element,
        coords: {
          x: elementCoords.elementLeft,
          y: elementCoords.elementTop,
        },
        offsetFromCorner: {
          x: pinchX - elementCoords.elementLeft,
          y: pinchY - elementCoords.elementTop,
        },
      };
      const isTopElement = element === state.lastGrabbedElement;
      if (isTopElement) {
        return grabbedElement;
      }
    }
  }
  return grabbedElement;
};

function log(...args) {
  if (OPTIONS.IS_DEBUG_MODE) {
    console.log(...args);
  }
}

function getCurrentHand(handData) {
  const isHandAvailable = !!handData.multiHandLandmarks?.[0];
  if (!isHandAvailable) { return null; }
  const mirroredHand = handData.multiHandedness[0].label === 'Left' ? 'right' : 'left';
  return mirroredHand;
}

function isPinched(handData) {
  if (isPrimaryHandAvailable(handData)) {
    const fingerTip = handData.multiHandLandmarks[0][handParts.indexFinger.tip];
    const thumbTip = handData.multiHandLandmarks[0][handParts.thumb.tip];
    const distance = {
      x: Math.abs(fingerTip.x - thumbTip.x),
      y: Math.abs(fingerTip.y - thumbTip.y),
      z: Math.abs(fingerTip.z - thumbTip.z),
    };
    const areFingersCloseEnough = distance.x < 0.08 && distance.y < 0.08 && distance.z < 0.11;
    log(distance);
    log({isPinched: areFingersCloseEnough});
    return areFingersCloseEnough;
  }
  return false;
}

function convertCoordsToDomPosition({ x, y }) {
  return {
    x: `${x * 100}vw`,
    y: `${y * 100}vh`,
  };
}

function updateDebugCanvas(handData) {
  debugCanvasCtx.save();
  debugCanvasCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
  debugCanvasCtx.drawImage(handData.image, 0, 0, debugCanvas.width, debugCanvas.height);
  if (handData.multiHandLandmarks) {
    for (const landmarks of handData.multiHandLandmarks) {
      drawConnectors(debugCanvasCtx, landmarks, HAND_CONNECTIONS, {color: '#0ff', lineWidth: 5});
      drawLandmarks(debugCanvasCtx, landmarks, {color: '#f0f', lineWidth: 2});
    }
  }
  debugCanvasCtx.restore();
}

function getCursorPosition(handData) {
  const { x, y, z } = handData.multiHandLandmarks[0][handParts.indexFinger.middle];
  const mirroredXCoord = -x + 1; /* due to camera mirroring */
  return { x: mirroredXCoord, y, z };
}

function isPrimaryHandAvailable(handData) {
  return getCurrentHand(handData) === OPTIONS.PREFERRED_HAND;
}

function onResults(handData) {
  if (!handData) { return; }
  if (OPTIONS.IS_DEBUG_MODE) { updateDebugCanvas(handData); }

  updateCursor(handData);
  updatePinchState(handData);
}

function updateCursor(handData) {
  if (isPrimaryHandAvailable(handData)) {
    const cursorPosition = getCursorPosition(handData);
    if (!cursorPosition) { return; }
    const { x, y } = convertCoordsToDomPosition(cursorPosition);
    cursor.style.transform = `translate(${x}, ${y})`;
  }
}

function updatePinchState(handData) {
  const wasPinchedBefore = state.isPinched;
  const isPinchedNow = isPinched(handData);
  const hasPassedPinchThreshold = isPinchedNow !== wasPinchedBefore;
  const hasWaitStarted = !!state.pinchChangeTimeout;

  if (hasPassedPinchThreshold && !hasWaitStarted) {
    registerChangeAfterWait(handData, isPinchedNow);
  }

  if (!hasPassedPinchThreshold) {
    cancelWaitForChange();
    if (isPinchedNow) {
      triggerEvent({
        eventName: PINCH_EVENTS.MOVE,
        eventData: handData,
      });
    }
  }
}

function registerChangeAfterWait(handData, isPinchedNow) {
  state.pinchChangeTimeout = setTimeout(() => {
    state.isPinched = isPinchedNow;
    triggerEvent({
      eventName: isPinchedNow ? PINCH_EVENTS.START : PINCH_EVENTS.STOP,
      eventData: handData,
    });
  }, OPTIONS.PINCH_DELAY_MS);
}

function cancelWaitForChange() {
  clearTimeout(state.pinchChangeTimeout);
  state.pinchChangeTimeout = null;
}

document.addEventListener(PINCH_EVENTS.START, onPinchStart);
document.addEventListener(PINCH_EVENTS.MOVE, onPinchMove);
document.addEventListener(PINCH_EVENTS.STOP, onPinchStop);
document.addEventListener(PINCH_EVENTS.PICK_UP, onPickUp);
document.addEventListener(PINCH_EVENTS.DROP, onDrop);

function onPinchStart(eventInfo) {
  const handData = eventInfo.detail;
  const cursorPosition = getCursorPosition(handData);

  state.grabbedElement = getPinchedElement({
    pinchX: cursorPosition.x,
    pinchY: cursorPosition.y,
    elements: movableElements,
  });
  if (state.grabbedElement) {
    triggerEvent({
      eventName: PINCH_EVENTS.PICK_UP,
      eventData: state.grabbedElement.domNode,
    });
  }

  document.body.classList.add('is-pinched');
}

function onPinchMove(eventInfo) {
  const handData = eventInfo.detail;
  const cursorPosition = getCursorPosition(handData);

  if (state.grabbedElement) {
    state.grabbedElement.coords = {
      x: cursorPosition.x - state.grabbedElement.offsetFromCorner.x,
      y: cursorPosition.y - state.grabbedElement.offsetFromCorner.y,
    };

    const { x, y } = convertCoordsToDomPosition(state.grabbedElement.coords);
    state.grabbedElement.domNode.style.transform = `translate(${x}, ${y})`;
  }
}

function onPinchStop() {
  document.body.classList.remove('is-pinched');
  if (state.grabbedElement) {
    triggerEvent({
      eventName: PINCH_EVENTS.DROP,
      eventData: state.grabbedElement.domNode,
    });
  }
}

function onPickUp(eventInfo) {
  const element = eventInfo.detail;
  state.lastGrabbedElement?.style.removeProperty('z-index');
  state.lastGrabbedElement = element;
  element.style.zIndex = 1;
  element.classList.add('element_dragging');
};

function onDrop(eventInfo) {
  const element = eventInfo.detail;
  state.isDragging = false;
  state.grabbedElement = undefined;
  element.classList.remove('element_dragging');
};

const hands = new Hands({locateFile: (file) => {
  return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
}});
hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});
hands.onResults(onResults);

const camera = new Camera(videoElement, {
  onFrame: async () => {
    await hands.send({image: videoElement});
  },
  width: 1280,
  height: 720
});
camera.start();

function startDebug() {
  debugCanvas.style.display = 'block';
  document.head.innerHTML += `
    <style>
      body.is-pinched {
        background: gold;
      }
    </style>
  `;
}
if (OPTIONS.IS_DEBUG_MODE) {
  startDebug();
}
