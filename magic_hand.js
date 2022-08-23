const state = {
  isDebugMode: false,
  preferredHand: 'right', // change to 'left' if you want
  handData: null,
  isPinched: false,
  pinchedElement: false,
  pinchDelayMs: 60,
  pinchChangeTimeout: null,
  cursorPosition: { x: 0, y: 0 },
};

const pinchStart = new CustomEvent('pinch_start', { detail: state.cursorPosition });
const pinchMove = new CustomEvent('pinch_move', { detail: state.cursorPosition });
const pinchStop = new CustomEvent('pinch_stop', { detail: state.cursorPosition });

const pinchPickUp = new CustomEvent('pinch_pick_up', { detail: state.cursorPosition });
const pinchDrop = new CustomEvent('pinch_drop', { detail: state.cursorPosition });

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

const getElementCoords = (element) => {
  const rect = element.getBoundingClientRect();
  const elementTop = rect.top / window.innerHeight;
  const elementBottom = rect.bottom / window.innerHeight;
  const elementLeft = rect.left / window.innerWidth;
  const elementRight = rect.right / window.innerWidth;
  return { elementTop, elementBottom, elementLeft, elementRight };
};

const isElementPinched = ({ pinchX, pinchY, elementTop, elementBottom, elementLeft, elementRight }) => {
  const isPinchInXRange = elementLeft <= pinchX && pinchX <= elementRight;
  const isPinchInYRange = elementTop <= pinchY && pinchY <= elementBottom;
  return isPinchInXRange && isPinchInYRange;
};

const getPinchedElement = ({ pinchX, pinchY, elements }) => {
  let pinchedElement;
  for (const element of elements) {
    const elementCoords = getElementCoords(element);
    if (isElementPinched({ pinchX, pinchY, ...elementCoords })) {
      pinchedElement = {
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
        return pinchedElement;
      }
    }
  }
  return pinchedElement;
};

const pickUp = (element) => {
  state.lastGrabbedElement?.style.removeProperty('z-index');
  state.lastGrabbedElement = element;
  element.style.zIndex = 1;
  element.classList.add('element_dragging');
  document.dispatchEvent(pinchPickUp);
};

const drop = (element) => {
  state.isDragging = false;
  state.pinchedElement = undefined;
  element.classList.remove('element_dragging');
  document.dispatchEvent(pinchDrop);
};

function log(...args) {
  if (state.isDebugMode) {
    console.log(...args);
  }
}

function getCurrentHand() {
  if (!isHandAvailable()) { return null; }
  const mirroredHand = state.handData.multiHandedness[0].label === 'Left' ? 'right' : 'left';
  return mirroredHand;
}

function isPinched() {
  if (isPrimaryHandAvailable()) {
    const fingerTip = state.handData.multiHandLandmarks[0][handParts.indexFinger.tip];
    const thumbTip = state.handData.multiHandLandmarks[0][handParts.thumb.tip];
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

function updateDebugCanvas() {
  debugCanvasCtx.save();
  debugCanvasCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
  debugCanvasCtx.drawImage(state.handData.image, 0, 0, debugCanvas.width, debugCanvas.height);
  if (state.handData.multiHandLandmarks) {
    for (const landmarks of state.handData.multiHandLandmarks) {
      drawConnectors(debugCanvasCtx, landmarks, HAND_CONNECTIONS, {color: '#0ff', lineWidth: 5});
      drawLandmarks(debugCanvasCtx, landmarks, {color: '#f0f', lineWidth: 2});
    }
  }
  debugCanvasCtx.restore();
}

function flipCoordinate(coordinate) {
  return -coordinate + 1;
};

function getMirroredCoords(coords) {
  if (!coords) { return; }
  const { x, y, z } = coords;
  return { x: flipCoordinate(x), y, z };
}

function isHandAvailable() {
  return state.handData.multiHandLandmarks[0];
}

function isPrimaryHand(preferredHand) {
  return getCurrentHand() === preferredHand;
}

function isPrimaryHandAvailable() {
  return isHandAvailable() && isPrimaryHand(state.preferredHand);
}

function onResults(handData) {
  state.handData = handData;
  if (!state.handData) { return; }
  if (state.isDebugMode) { updateDebugCanvas(); }

  updateCursor();
  updatePinchState();
}

function updateCursor() {
  if (isPrimaryHandAvailable(state.handData)) {
    const fingerCoords = getMirroredCoords(state.handData.multiHandLandmarks[0][handParts.indexFinger.middle]);
    if (!fingerCoords) { return; }
    Object.assign(state.cursorPosition, fingerCoords);
    const { x, y } = convertCoordsToDomPosition(state.cursorPosition);
    cursor.style.transform = `translate(${x}, ${y})`;
  }
}

function updatePinchState() {
  const wasPinchedBefore = state.isPinched;
  const isPinchedNow = isPinched();
  const hasPassedPinchThreshold = isPinchedNow !== wasPinchedBefore;
  const hasWaitStarted = !!state.pinchChangeTimeout;

  if (hasPassedPinchThreshold && !hasWaitStarted) {
    registerChangeAfterWait(isPinchedNow);
  }

  if (!hasPassedPinchThreshold) {
    cancelWaitForChange();
    if (isPinchedNow) { document.dispatchEvent(pinchMove); }
  }
}

function registerChangeAfterWait(isPinchedNow) {
  state.pinchChangeTimeout = setTimeout(() => {
    state.isPinched = isPinchedNow;
    document.dispatchEvent(isPinchedNow ? pinchStart : pinchStop);
  }, state.pinchDelayMs);
}

function cancelWaitForChange() {
  clearTimeout(state.pinchChangeTimeout);
  state.pinchChangeTimeout = null;
}

document.addEventListener('pinch_start', onPinchStart);
document.addEventListener('pinch_move', onPinchMove);
document.addEventListener('pinch_stop', onPinchStop);

function onPinchStart() {
  document.body.classList.add('is-pinched');

  const pinchStartPoint = getMirroredCoords(state.handData.multiHandLandmarks[0][handParts.indexFinger.middle]);
  state.pinchedElement = getPinchedElement({
    pinchX: pinchStartPoint.x,
    pinchY: pinchStartPoint.y,
    elements: movableElements,
  });
  if (state.pinchedElement) {
    pickUp(state.pinchedElement.domNode);
  }
}

function onPinchMove() {
  const pinchCurrentPoint = getMirroredCoords(state.handData.multiHandLandmarks[0][handParts.indexFinger.middle]);

  if (state.pinchedElement) {
    state.pinchedElement.coords = {
      x: pinchCurrentPoint.x - state.pinchedElement.offsetFromCorner.x,
      y: pinchCurrentPoint.y - state.pinchedElement.offsetFromCorner.y,
    };

    const { x, y } = convertCoordsToDomPosition(state.pinchedElement.coords);
    state.pinchedElement.domNode.style.transform = `translate(${x}, ${y})`;
  }
}

function onPinchStop() {
  document.body.classList.remove('is-pinched');
  if (state.pinchedElement) {
    drop(state.pinchedElement.domNode);
  }
}

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
if (state.isDebugMode) {
  startDebug();
}
