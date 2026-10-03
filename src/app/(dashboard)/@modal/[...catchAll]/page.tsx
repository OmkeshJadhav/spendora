/**
 * Closes the modal on navigation elsewhere.
 *
 * A soft navigation leaves a parallel slot showing whatever it last matched,
 * so without this an open modal would stay up after its form redirects to the
 * list. Matching every other URL to nothing is what takes it down.
 */
export default function ModalCatchAll() {
  return null;
}
