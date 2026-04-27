use super::*;

pub(crate) fn legal_rally_actions(
    state: &GameState,
    indexes: &GameIndexes,
    unit: &Unit,
) -> Vec<LegalAction> {
    if !can_rally_with_indexes(unit, state, indexes) {
        return Vec::new();
    }
    let Some(pip_cost) = single_action_pip_cost_with_indexes(indexes, unit, "rally", &[]) else {
        return Vec::new();
    };
    if pip_cost > state.pips_remaining {
        return Vec::new();
    }
    vec![LegalAction::Rally {
        unit_id: unit.id.clone(),
        pip_cost,
    }]
}

pub(crate) fn legal_reform_pike_actions(
    state: &GameState,
    indexes: &GameIndexes,
    unit: &Unit,
) -> Vec<LegalAction> {
    if !can_reform_pike_with_indexes(unit, state, indexes) {
        return Vec::new();
    }
    let Some(pip_cost) = single_action_pip_cost_with_indexes(indexes, unit, "reform_pike", &[])
    else {
        return Vec::new();
    };
    if pip_cost > state.pips_remaining {
        return Vec::new();
    }
    vec![LegalAction::ReformPike {
        unit_id: unit.id.clone(),
        pip_cost,
    }]
}

pub(crate) fn legal_rotate_actions(
    state: &GameState,
    indexes: &GameIndexes,
    unit: &Unit,
) -> Vec<LegalAction> {
    if !adjacent_enemies_with_indexes(state, indexes, unit).is_empty() {
        return Vec::new();
    }

    let ignored = HashSet::from([unit.id.clone()]);
    let allowed_facings: Vec<Direction> = ROTATION_ORDER
        .iter()
        .filter(|facing| {
            **facing != unit.facing
                && can_enter_cell_with_indexes(state, indexes, unit, &unit.position, Some(facing))
                && placement_is_clear(
                    &unit.position,
                    facing,
                    indexes.occupied_cells(),
                    Some(&ignored),
                )
        })
        .cloned()
        .collect();

    let pip_cost = single_action_pip_cost_with_indexes(indexes, unit, "rotate", &[]);
    if pip_cost.is_none() || pip_cost.unwrap_or_default() > state.pips_remaining {
        return Vec::new();
    }

    ROTATION_ORDER
        .iter()
        .filter(|facing| {
            allowed_facings.iter().any(|allowed| allowed == *facing) && **facing != unit.facing
        })
        .map(|facing| LegalAction::Rotate {
            unit_id: unit.id.clone(),
            facing: facing.clone(),
            pip_cost: pip_cost.unwrap_or(1),
        })
        .collect()
}

pub(crate) fn legal_charge_actions(
    state: &GameState,
    indexes: &GameIndexes,
    unit: &Unit,
) -> Vec<LegalAction> {
    if !adjacent_enemies_with_indexes(state, indexes, unit).is_empty() {
        return Vec::new();
    }

    movement_endpoints_with_indexes(state, indexes, unit, indexes.occupied_cells())
        .charges
        .into_iter()
        .filter_map(|candidate| {
            let pip_cost =
                single_action_pip_cost_with_indexes(indexes, unit, "charge", &candidate.path)?;
            if pip_cost > state.pips_remaining {
                return None;
            }
            let moved_unit = Unit {
                position: candidate.destination.clone(),
                facing: candidate.facing.clone(),
                ..unit.clone()
            };
            let aspect = crate::combat::attack_aspect(&moved_unit, &candidate.defender).to_string();
            let warning = ordered_pike_charge_warning_with_indexes(
                unit,
                &candidate.defender,
                &aspect,
                state,
                indexes,
            );
            Some(LegalAction::Charge {
                unit_id: unit.id.clone(),
                target_id: candidate.defender.id.clone(),
                destination: candidate.destination,
                path: candidate.path,
                facing: candidate.facing,
                aspect,
                pip_cost,
                warning,
            })
        })
        .collect()
}

pub(crate) fn legal_march_actions(
    state: &GameState,
    indexes: &GameIndexes,
    unit: &Unit,
) -> Vec<LegalAction> {
    if !adjacent_enemies_with_indexes(state, indexes, unit).is_empty() {
        return Vec::new();
    }

    march_endpoints_with_indexes(state, indexes, unit, indexes.occupied_cells())
        .into_iter()
        .filter_map(|candidate| {
            let pip_cost =
                single_action_pip_cost_with_indexes(indexes, unit, "march_move", &candidate.path)?;
            if pip_cost > state.pips_remaining {
                return None;
            }
            Some(LegalAction::MarchMove {
                unit_id: unit.id.clone(),
                destination: candidate.destination,
                path: candidate.path,
                facing: candidate.facing,
                pip_cost,
            })
        })
        .collect()
}

pub(crate) fn legal_move_actions(
    state: &GameState,
    indexes: &GameIndexes,
    unit: &Unit,
) -> Vec<LegalAction> {
    let in_enemy_contact = !adjacent_enemies_with_indexes(state, indexes, unit).is_empty();
    if in_enemy_contact && (!unit.can_evade || unit.disordered) {
        return Vec::new();
    }

    movement_endpoints_with_indexes(state, indexes, unit, indexes.occupied_cells())
        .moves
        .into_iter()
        .filter_map(|candidate| {
            let pip_cost =
                single_action_pip_cost_with_indexes(indexes, unit, "move", &candidate.path)?;
            if pip_cost > state.pips_remaining {
                return None;
            }
            Some(LegalAction::Move {
                unit_id: unit.id.clone(),
                destination: candidate.destination,
                path: candidate.path,
                facing: candidate.facing,
                pip_cost,
            })
        })
        .collect()
}

pub(crate) fn legal_shoot_actions(
    state: &GameState,
    indexes: &GameIndexes,
    unit: &Unit,
) -> Vec<LegalAction> {
    let profile = unit_profile(&unit.kind);
    if profile.missile_range == 0 || !adjacent_enemies_with_indexes(state, indexes, unit).is_empty()
    {
        return Vec::new();
    }

    let Some(pip_cost) = single_action_pip_cost_with_indexes(indexes, unit, "shoot", &[]) else {
        return Vec::new();
    };
    if pip_cost > state.pips_remaining {
        return Vec::new();
    }

    visible_enemies_in_sector_with_indexes(state, indexes, unit, indexes.occupied_cells())
        .into_iter()
        .map(|(target, range)| LegalAction::Shoot {
            unit_id: unit.id.clone(),
            target_id: target.id.clone(),
            range,
            pip_cost,
        })
        .collect()
}
