import type { BattlefieldPickTarget } from '../battlefieldInteraction'

export function arePickTargetsEqual(left: BattlefieldPickTarget | null, right: BattlefieldPickTarget | null): boolean {
  if (left === right) {
    return true
  }
  if (!left || !right) {
    return false
  }
  if (left.kind !== right.kind || left.key !== right.key) {
    return false
  }
  if (left.kind === 'unit' && right.kind === 'unit') {
    return left.unit.id === right.unit.id
  }
  return true
}
