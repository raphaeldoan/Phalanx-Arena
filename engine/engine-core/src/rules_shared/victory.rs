use super::*;

pub(crate) fn game_is_over(state: &GameState) -> bool {
    state.winner.is_some() || state.draw
}

pub(crate) fn surviving_units_for_army(state: &GameState, army: &ArmyId) -> usize {
    state
        .units
        .iter()
        .filter(|unit| unit.army == *army && !unit.eliminated)
        .count()
}

pub(crate) fn refresh_battle_scores(state: &mut GameState) {
    ensure_battle_scores(state);
    ensure_attrition_status(state);
    ensure_armies(state);
    if state.victory_target <= 0 {
        let highest_target = state
            .attrition_status
            .iter()
            .map(|status| status.target_losses)
            .max()
            .unwrap_or(4);
        state.victory_target = i32::max(5, (highest_target as i32) + 1);
    }

    for army in [ArmyId::A, ArmyId::B] {
        let enemy = enemy_army(&army);
        let enemy_losses = state
            .armies
            .iter()
            .find(|status| status.id == enemy)
            .map(|status| status.morale_loss.max(0) as usize)
            .unwrap_or(0);
        let Some(score) = battle_score_for_army(state, &army) else {
            continue;
        };
        score.enemy_losses = enemy_losses;
        score.total = score.enemy_losses;
    }
}

pub(crate) fn apply_victory_transitions(state: &mut GameState) {
    const ENDGAME_SURVIVOR_THRESHOLD: usize = 2;
    const ENDGAME_CLOCK_BOUNDS: i32 = 4;

    state.winner_reason = None;
    let surviving_a = surviving_units_for_army(state, &ArmyId::A);
    let surviving_b = surviving_units_for_army(state, &ArmyId::B);
    match (surviving_a, surviving_b) {
        (0, 0) => {
            state.draw = true;
            state.winner_reason =
                Some("Mutual destruction draw: neither army has any surviving units.".to_string());
            if let Some(reason) = &state.winner_reason {
                append_log(state, reason.clone());
            }
            return;
        }
        (0, _) => {
            state.winner = Some(ArmyId::B);
            state.winner_reason = Some("Army B wins: Army A has no surviving units.".to_string());
            if let Some(reason) = &state.winner_reason {
                append_log(state, reason.clone());
            }
            return;
        }
        (_, 0) => {
            state.winner = Some(ArmyId::A);
            state.winner_reason = Some("Army A wins: Army B has no surviving units.".to_string());
            if let Some(reason) = &state.winner_reason {
                append_log(state, reason.clone());
            }
            return;
        }
        _ => {}
    }

    let broken_a = state
        .armies
        .iter()
        .find(|army| army.id == ArmyId::A)
        .is_some_and(|army| army.broken);
    let broken_b = state
        .armies
        .iter()
        .find(|army| army.id == ArmyId::B)
        .is_some_and(|army| army.broken);
    match (broken_a, broken_b) {
        (true, false) => {
            state.winner = Some(ArmyId::B);
            state.winner_reason = Some("Army B wins: Army A is broken.".to_string());
        }
        (false, true) => {
            state.winner = Some(ArmyId::A);
            state.winner_reason = Some("Army A wins: Army B is broken.".to_string());
        }
        (true, true) => {
            let morale_a = state
                .armies
                .iter()
                .find(|army| army.id == ArmyId::A)
                .map(|army| army.morale_loss)
                .unwrap_or(0);
            let morale_b = state
                .armies
                .iter()
                .find(|army| army.id == ArmyId::B)
                .map(|army| army.morale_loss)
                .unwrap_or(0);
            if morale_a < morale_b {
                state.winner = Some(ArmyId::A);
                state.winner_reason = Some(format!(
                    "Army A wins: both armies broke, but A has lower morale loss ({morale_a}-{morale_b})."
                ));
            } else if morale_b < morale_a {
                state.winner = Some(ArmyId::B);
                state.winner_reason = Some(format!(
                    "Army B wins: both armies broke, but B has lower morale loss ({morale_b}-{morale_a})."
                ));
            } else {
                state.draw = true;
                state.winner_reason = Some(format!(
                    "Draw: both armies broke with equal morale loss ({morale_a}-{morale_b})."
                ));
            }
        }
        (false, false) => {}
    }
    if game_is_over(state) {
        if let Some(reason) = &state.winner_reason {
            append_log(state, reason.clone());
        }
        return;
    }

    if !state.use_endgame_clock {
        return;
    }

    let mut sorted_scores: Vec<BattleScore> = state.battle_scores.clone();
    sorted_scores.sort_by(|left, right| {
        right
            .enemy_losses
            .cmp(&left.enemy_losses)
            .then(right.total.cmp(&left.total))
    });

    if sorted_scores.len() < 2 {
        return;
    }

    if state.endgame_deadline_bound.is_none()
        && surviving_a <= ENDGAME_SURVIVOR_THRESHOLD
        && surviving_b <= ENDGAME_SURVIVOR_THRESHOLD
    {
        let deadline = state.bound_number + ENDGAME_CLOCK_BOUNDS;
        state.endgame_deadline_bound = Some(deadline);
        append_log(
            state,
            format!(
                "Endgame clock started: both armies are down to {} units or fewer. If no one wins sooner, the battle will be decided after bound {}.",
                ENDGAME_SURVIVOR_THRESHOLD,
                deadline
            ),
        );
    }

    let Some(deadline) = state.endgame_deadline_bound else {
        return;
    };
    if state.bound_number <= deadline {
        return;
    }

    if sorted_scores[0].enemy_losses == sorted_scores[1].enemy_losses
        && sorted_scores[0].total == sorted_scores[1].total
    {
        state.draw = true;
        state.winner_reason = Some(format!(
            "Endgame draw: the clock expired after bound {} with the battle score tied {}-{}.",
            deadline, sorted_scores[0].enemy_losses, sorted_scores[1].enemy_losses
        ));
    } else {
        let winner_score = &sorted_scores[0];
        let runner_up = &sorted_scores[1];
        state.winner = Some(winner_score.army.clone());
        state.winner_reason = Some(format!(
            "Endgame decision: {} led {}-{} when the clock expired after bound {}.",
            format_army(&winner_score.army),
            winner_score.enemy_losses,
            runner_up.enemy_losses,
            deadline
        ));
    }
    if let Some(reason) = &state.winner_reason {
        append_log(state, reason.clone());
    }
}

pub(crate) fn update_victory_state(state: &mut GameState) {
    if game_is_over(state) || !matches!(state.phase, GamePhase::Battle) {
        return;
    }
    refresh_battle_scores(state);
    apply_victory_transitions(state);
}
