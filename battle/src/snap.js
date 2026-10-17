/**
 * Centre a camera so the world lands on whole screen pixels. Static objects sit at whole world pixels
 * and the zoom is a whole number, so every object then has an exact screen position and nothing
 * rounds differently from the ground from one frame to the next.
 */
export function centerSnapped(cam, x, y) {
  const z = cam.zoom;
  // screen x of world point p = (p - scrollX - w/2) * z + w/2; make (scrollX + w/2) * z - w/2 whole
  const sx = (Math.round(x * z - cam.width / 2) + cam.width / 2) / z - cam.width / 2;
  const sy = (Math.round(y * z - cam.height / 2) + cam.height / 2) / z - cam.height / 2;
  cam.setScroll(sx, sy);
}
