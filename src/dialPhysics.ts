const FULL_TURN = Math.PI * 2;

export type DialGesture = {
  pointerAngle: number;
  unwrappedTravel: number;
  clockwiseTravel: number;
};

export function clockwiseTravelToStop(restAngle: number, stopAngle: number) {
  const travel = (restAngle - stopAngle) % FULL_TURN;
  return travel < 0 ? travel + FULL_TURN : travel;
}

export function beginDialGesture(pointerAngle: number): DialGesture {
  return {
    pointerAngle,
    unwrappedTravel: 0,
    clockwiseTravel: 0,
  };
}

export function advanceDialGesture(gesture: DialGesture, pointerAngle: number): DialGesture {
  const rawDelta = pointerAngle - gesture.pointerAngle;
  const signedDelta = Math.atan2(Math.sin(rawDelta), Math.cos(rawDelta));
  const unwrappedTravel = gesture.unwrappedTravel + signedDelta;

  return {
    pointerAngle,
    unwrappedTravel,
    clockwiseTravel: Math.max(gesture.clockwiseTravel, unwrappedTravel, 0),
  };
}
