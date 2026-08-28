/*
 * The width the navbar's middle button reserves for its label.
 *
 * Shared by both bottom navbars — the control panel's, where the middle button
 * changes its wording as the round or the raffle moves on, and the staff
 * ticket's, where it reads Control Panel. A control that changes width under
 * the thumb between presses is a control you can mis-tap, and the two bars
 * standing in for each other as staff move between the panel and their own
 * number is the same problem one screen wider: the button reserves this
 * string's width at all times and draws the live label over the top, so every
 * step — and every screen — is the same size without anyone having to measure
 * a font.
 *
 * Sized to the widest label either navbar can actually reach. The control
 * panel's navbar follows the display rather than the open tab, so the two
 * Switch To ... Display labels — the longest either panel can carry — never
 * appear there; of the rest, the widest is Start Round with a two-digit round
 * on the end, and it clears Control Panel with room to spare.
 *
 * It is a size and not a caption, which is why it is a round number no event
 * will see rather than a real one: the reserve must not change width when the
 * round ticks from 9 to 10. An event that somehow reached three digits would
 * ellipsise this one label rather than resize the button, which is the right
 * way round.
 */
export const NAVBAR_ACTION_WIDEST_LABEL = "Start Round 88";
