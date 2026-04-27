use super::*;

pub(crate) fn ensure_attrition_status(state: &mut GameState) {
    if !state.attrition_status.is_empty() {
        return;
    }

    for army in [ArmyId::A, ArmyId::B] {
        let starting_units = state.units.iter().filter(|unit| unit.army == army).count();
        let losses = state
            .units
            .iter()
            .filter(|unit| unit.army == army && unit.eliminated)
            .count();
        state.attrition_status.push(AttritionStatus {
            army,
            starting_units,
            losses,
            target_losses: usize::max(4, starting_units.div_ceil(3)),
        });
    }
}

pub(crate) fn ensure_battle_scores(state: &mut GameState) {
    if !state.battle_scores.is_empty() {
        return;
    }
    for army in [ArmyId::A, ArmyId::B] {
        state.battle_scores.push(BattleScore {
            army,
            enemy_losses: 0,
            total: 0,
        });
    }
}

pub(crate) fn ensure_armies(state: &mut GameState) {
    if !state.armies.is_empty() {
        return;
    }
    for army in [ArmyId::A, ArmyId::B] {
        let total_morale: i32 = state
            .units
            .iter()
            .filter(|unit| unit.army == army)
            .map(get_morale_value)
            .sum();
        state.armies.push(Army {
            id: army.clone(),
            pips: 0,
            morale_loss: state
                .units
                .iter()
                .filter(|unit| unit.army == army && unit.eliminated)
                .map(get_morale_value)
                .sum(),
            morale_threshold: ((total_morale as f32) * 0.4).ceil() as i32,
            shaken: false,
            broken: false,
        });
    }
}

pub(crate) fn sync_army_pips(state: &mut GameState) {
    ensure_armies(state);
    for army in &mut state.armies {
        army.pips = if army.id == state.current_player {
            state.pips_remaining
        } else {
            0
        };
    }
}

pub(crate) fn apply_morale_loss(
    state: &mut GameState,
    army_id: &ArmyId,
    unit: &Unit,
    reason: &str,
) {
    ensure_armies(state);
    let mut added = get_morale_value(unit);
    if unit.leader && unit.army_general {
        added += 4;
    }
    if added <= 0 {
        return;
    }
    if let Some(army) = state.armies.iter_mut().find(|army| army.id == *army_id) {
        army.morale_loss += added;
        let morale_loss = army.morale_loss;
        let morale_threshold = army.morale_threshold;
        append_log(
            state,
            format!(
                "{} morale loss +{} for {} ({}), now {}/{}.",
                format_army(army_id),
                added,
                unit.name,
                reason,
                morale_loss,
                morale_threshold
            ),
        );
    }
}

pub(crate) fn check_army_morale(
    state: &mut GameState,
    shaken_at_bound_start: &HashMap<ArmyId, bool>,
) {
    ensure_armies(state);
    let mut pending_logs = Vec::new();
    for army in &mut state.armies {
        if army.morale_loss >= army.morale_threshold {
            if shaken_at_bound_start
                .get(&army.id)
                .copied()
                .unwrap_or(army.shaken)
                && !army.broken
            {
                army.broken = true;
                pending_logs.push(format!(
                    "{} is broken at {}/{} morale loss.",
                    format_army(&army.id),
                    army.morale_loss,
                    army.morale_threshold
                ));
            }
            if !army.shaken {
                army.shaken = true;
                pending_logs.push(format!(
                    "{} is shaken at {}/{} morale loss.",
                    format_army(&army.id),
                    army.morale_loss,
                    army.morale_threshold
                ));
            }
        }
    }
    for message in pending_logs {
        append_log(state, message);
    }
    update_victory_state(state);
}

pub(crate) fn attrition_status_for_army<'a>(
    state: &'a mut GameState,
    army: &ArmyId,
) -> Option<&'a mut AttritionStatus> {
    ensure_attrition_status(state);
    state
        .attrition_status
        .iter_mut()
        .find(|status| status.army == *army)
}

pub(crate) fn battle_score_for_army<'a>(
    state: &'a mut GameState,
    army: &ArmyId,
) -> Option<&'a mut BattleScore> {
    ensure_battle_scores(state);
    state
        .battle_scores
        .iter_mut()
        .find(|score| score.army == *army)
}
