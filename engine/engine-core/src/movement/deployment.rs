use super::*;

pub(crate) fn legal_deployment_actions(state: &GameState) -> Vec<LegalAction> {
    let indexes = GameIndexes::new(state);
    legal_deployment_actions_with_indexes(state, &indexes)
}

pub(crate) fn legal_deployment_actions_with_indexes(
    state: &GameState,
    indexes: &GameIndexes,
) -> Vec<LegalAction> {
    let all_deployed = indexes
        .active_units(state, &state.current_player)
        .all(|unit| unit.deployed);
    let mut actions = if all_deployed {
        vec![LegalAction::FinalizeDeployment]
    } else {
        Vec::new()
    };
    for unit in indexes.active_units(state, &state.current_player) {
        for destination in
            deployment_destinations_with_indexes(state, indexes, unit, indexes.occupied_cells())
        {
            actions.push(LegalAction::Deploy {
                unit_id: unit.id.clone(),
                destination,
            });
        }
    }
    dedupe_and_sort(actions)
}

pub(crate) fn apply_deploy_resolved(
    state: &mut GameState,
    unit_id: &str,
    destination: &Coord,
) -> Result<(), EngineError> {
    if state.phase != GamePhase::Deployment {
        return Err(EngineError::InvalidAction(
            "Deployment actions are only legal during deployment.".to_string(),
        ));
    }
    if state.deployment_ready.contains(&state.current_player) {
        return Err(EngineError::InvalidAction(
            "This army has already finalized deployment.".to_string(),
        ));
    }

    let unit_index = find_unit_index(state, unit_id)
        .ok_or_else(|| EngineError::InvalidAction(format!("unknown unit id: {unit_id}")))?;
    if state.units[unit_index].army != state.current_player {
        return Err(EngineError::InvalidAction(
            "Only the active player's units can deploy.".to_string(),
        ));
    }
    if !legal_deployment_destination(state, &state.units[unit_index], destination) {
        return Err(EngineError::InvalidAction(
            "Illegal deployment destination.".to_string(),
        ));
    }

    let origin = state.units[unit_index].position.clone();
    state.units[unit_index].position = destination.clone();
    state.units[unit_index].deployed = true;
    append_log(
        state,
        format!(
            "{:?} {} deployed from {} to {}.",
            state.units[unit_index].army,
            state.units[unit_index].name,
            format_coord(&origin),
            format_coord(&state.units[unit_index].position)
        ),
    );
    Ok(())
}

pub(crate) fn finalize_deployment(state: &mut GameState) -> Result<(), EngineError> {
    if state.phase != GamePhase::Deployment {
        return Err(EngineError::InvalidAction(
            "Deployment is already complete.".to_string(),
        ));
    }
    let undeployed: Vec<String> = active_units(state, &state.current_player)
        .into_iter()
        .filter(|unit| !unit.deployed)
        .map(|unit| unit.id.clone())
        .collect();
    if !undeployed.is_empty() {
        return Err(EngineError::InvalidAction(format!(
            "Cannot finalize deployment until all units are deployed: {}.",
            undeployed.join(", ")
        )));
    }

    if !state.deployment_ready.contains(&state.current_player) {
        state.deployment_ready.push(state.current_player.clone());
    }
    append_log(
        state,
        format!("{:?} finalized deployment.", state.current_player),
    );

    if state.deployment_ready.len() == 2 {
        state.phase = GamePhase::Battle;
        state.current_player = state.first_bound_army.clone();
        state.last_pip_roll = FIXED_PIPS_PER_BOUND;
        state.pips_remaining = FIXED_PIPS_PER_BOUND;
        sync_army_pips(state);
        initialize_pike_formation_states(state);
        refresh_command_status(state, false);
        refresh_battle_scores(state);
        append_log(
            state,
            format!(
                "Battle begins. {:?} starts bound {} with {} PIPs.",
                state.current_player, state.bound_number, state.last_pip_roll
            ),
        );
    } else {
        state.current_player = enemy_army(&state.current_player);
        append_log(
            state,
            format!("{:?} deployment phase begins.", state.current_player),
        );
    }

    Ok(())
}
