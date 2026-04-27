use super::*;

pub(crate) fn legal_group_march_actions(
    state: &GameState,
    indexes: &GameIndexes,
) -> Vec<LegalAction> {
    enumerate_groups_with_indexes(state, indexes)
        .into_iter()
        .flat_map(|group_unit_ids| {
            legal_group_march_actions_for_group(state, indexes, &group_unit_ids)
        })
        .collect()
}

pub(crate) fn legal_group_march_actions_for_action(
    state: &GameState,
    indexes: &GameIndexes,
    group_unit_ids: &[String],
) -> Vec<LegalAction> {
    if !group_is_enumerated(state, indexes, group_unit_ids) {
        return Vec::new();
    }
    legal_group_march_actions_for_group(state, indexes, group_unit_ids)
}

pub(crate) fn legal_group_march_actions_for_group(
    state: &GameState,
    indexes: &GameIndexes,
    group_unit_ids: &[String],
) -> Vec<LegalAction> {
    let Some(group_units) = group_units_for_ids(state, indexes, group_unit_ids) else {
        return Vec::new();
    };
    if group_units
        .iter()
        .any(|unit| !adjacent_enemies_with_indexes(state, indexes, unit).is_empty())
    {
        return Vec::new();
    }
    if group_units.iter().any(|unit| {
        !threat_generators_at_with_indexes(
            state,
            indexes,
            &unit.army,
            &unit.position,
            Some(&HashSet::from([unit.id.clone()])),
        )
        .is_empty()
    }) {
        return Vec::new();
    }

    let mut actions = Vec::new();
    let ignored: HashSet<String> = group_unit_ids.iter().cloned().collect();
    let group_facing = group_units[0].facing.clone();
    let (dx, dy) = direction_delta(&group_facing);
    let base_speed = group_units
        .iter()
        .map(|unit| unit_profile(&unit.kind).movement)
        .min()
        .unwrap_or(0);
    let march_speed = group_units
        .iter()
        .map(|unit| unit_profile(&unit.kind).movement + unit_profile(&unit.kind).march_bonus)
        .min()
        .unwrap_or(0);
    if march_speed <= base_speed {
        return Vec::new();
    }

    for distance in (base_speed + 1)..=march_speed {
        if !group_march_translation_is_valid_with_indexes(
            state,
            indexes,
            &group_units,
            indexes.occupied_cells(),
            dx,
            dy,
            distance,
            &ignored,
        ) {
            continue;
        }
        let paths: Vec<Vec<Coord>> = group_units
            .iter()
            .map(|unit| group_move_path(unit, dx, dy, distance, (0, 0)))
            .collect();
        let Some(pip_cost) =
            group_action_pip_cost_with_indexes(indexes, &group_units, "group_march_move", &paths)
        else {
            continue;
        };
        if pip_cost > state.pips_remaining {
            continue;
        }
        actions.push(LegalAction::GroupMarchMove {
            unit_ids: group_unit_ids.to_vec(),
            steps: group_units
                .iter()
                .enumerate()
                .map(|(index, unit)| GroupMoveStep {
                    unit_id: unit.id.clone(),
                    destination: Coord {
                        x: unit.position.x + (dx * distance),
                        y: unit.position.y + (dy * distance),
                    },
                    path: paths[index].clone(),
                    facing: unit.facing.clone(),
                })
                .collect(),
            pip_cost,
        });
    }

    actions
}

pub(crate) fn legal_group_actions(state: &GameState, indexes: &GameIndexes) -> Vec<LegalAction> {
    enumerate_groups_with_indexes(state, indexes)
        .into_iter()
        .flat_map(|group_unit_ids| legal_group_actions_for_group(state, indexes, &group_unit_ids))
        .collect()
}

pub(crate) fn legal_group_actions_for_action(
    state: &GameState,
    indexes: &GameIndexes,
    group_unit_ids: &[String],
) -> Vec<LegalAction> {
    if !group_is_enumerated(state, indexes, group_unit_ids) {
        return Vec::new();
    }
    legal_group_actions_for_group(state, indexes, group_unit_ids)
}

pub(crate) fn legal_group_actions_for_group(
    state: &GameState,
    indexes: &GameIndexes,
    group_unit_ids: &[String],
) -> Vec<LegalAction> {
    let Some(group_units) = group_units_for_ids(state, indexes, group_unit_ids) else {
        return Vec::new();
    };
    if group_units
        .iter()
        .any(|unit| !adjacent_enemies_with_indexes(state, indexes, unit).is_empty())
    {
        return Vec::new();
    }

    let mut actions = Vec::new();
    let ignored: HashSet<String> = group_unit_ids.iter().cloned().collect();
    let group_facing = group_units[0].facing.clone();
    let (dx, dy) = direction_delta(&group_facing);
    let (left_dx, left_dy) = direction_delta(&left_flank_direction(&group_facing));
    let (right_dx, right_dy) = direction_delta(&right_flank_direction(&group_facing));
    let group_speed = group_units
        .iter()
        .map(|unit| unit_profile(&unit.kind).movement)
        .min()
        .unwrap_or(0);

    for distance in 1..=group_speed {
        if group_translation_is_valid_with_indexes(
            state,
            indexes,
            &group_units,
            indexes.occupied_cells(),
            dx,
            dy,
            distance,
            &ignored,
            (0, 0),
        ) {
            let paths: Vec<Vec<Coord>> = group_units
                .iter()
                .map(|unit| group_move_path(unit, dx, dy, distance, (0, 0)))
                .collect();
            if let Some(pip_cost) =
                group_action_pip_cost_with_indexes(indexes, &group_units, "group_move", &paths)
            {
                if pip_cost <= state.pips_remaining {
                    actions.push(LegalAction::GroupMove {
                        unit_ids: group_unit_ids.to_vec(),
                        steps: group_units
                            .iter()
                            .enumerate()
                            .map(|(index, unit)| GroupMoveStep {
                                unit_id: unit.id.clone(),
                                destination: Coord {
                                    x: unit.position.x + (dx * distance),
                                    y: unit.position.y + (dy * distance),
                                },
                                path: paths[index].clone(),
                                facing: unit.facing.clone(),
                            })
                            .collect(),
                        pip_cost,
                    });
                }
            }
        }

        if distance >= group_speed {
            continue;
        }

        for incline in [(left_dx, left_dy), (right_dx, right_dy)] {
            if !group_translation_is_valid_with_indexes(
                state,
                indexes,
                &group_units,
                indexes.occupied_cells(),
                dx,
                dy,
                distance,
                &ignored,
                incline,
            ) {
                continue;
            }
            let paths: Vec<Vec<Coord>> = group_units
                .iter()
                .map(|unit| group_move_path(unit, dx, dy, distance, incline))
                .collect();
            let Some(pip_cost) =
                group_action_pip_cost_with_indexes(indexes, &group_units, "group_move", &paths)
            else {
                continue;
            };
            if pip_cost > state.pips_remaining {
                continue;
            }
            actions.push(LegalAction::GroupMove {
                unit_ids: group_unit_ids.to_vec(),
                steps: group_units
                    .iter()
                    .enumerate()
                    .map(|(index, unit)| GroupMoveStep {
                        unit_id: unit.id.clone(),
                        destination: Coord {
                            x: unit.position.x + (dx * distance) + incline.0,
                            y: unit.position.y + (dy * distance) + incline.1,
                        },
                        path: paths[index].clone(),
                        facing: unit.facing.clone(),
                    })
                    .collect(),
                pip_cost,
            });
        }
    }

    actions
}

pub(crate) fn legal_group_charge_actions(
    state: &GameState,
    indexes: &GameIndexes,
) -> Vec<LegalAction> {
    enumerate_groups_with_indexes(state, indexes)
        .into_iter()
        .flat_map(|group_unit_ids| {
            legal_group_charge_actions_for_group(state, indexes, &group_unit_ids)
        })
        .collect()
}

pub(crate) fn legal_group_charge_actions_for_action(
    state: &GameState,
    indexes: &GameIndexes,
    group_unit_ids: &[String],
) -> Vec<LegalAction> {
    if !group_is_enumerated(state, indexes, group_unit_ids) {
        return Vec::new();
    }
    legal_group_charge_actions_for_group(state, indexes, group_unit_ids)
}

pub(crate) fn legal_group_charge_actions_for_group(
    state: &GameState,
    indexes: &GameIndexes,
    group_unit_ids: &[String],
) -> Vec<LegalAction> {
    let Some(group_units) = group_units_for_ids(state, indexes, group_unit_ids) else {
        return Vec::new();
    };
    if group_units
        .iter()
        .any(|unit| !adjacent_enemies_with_indexes(state, indexes, unit).is_empty())
    {
        return Vec::new();
    }

    let mut actions = Vec::new();
    let group_facing = group_units[0].facing.clone();
    let (dx, dy) = direction_delta(&group_facing);
    let ignored: HashSet<String> = group_unit_ids.iter().cloned().collect();
    let group_speed = group_units
        .iter()
        .map(|unit| unit_profile(&unit.kind).movement)
        .min()
        .unwrap_or(0);

    for distance in 1..=group_speed {
        let Some(steps) = group_charge_translation_with_indexes(
            state,
            indexes,
            &group_units,
            indexes.occupied_cells(),
            dx,
            dy,
            distance,
            &ignored,
        ) else {
            continue;
        };
        let paths: Vec<Vec<Coord>> = steps.iter().map(|step| step.path.clone()).collect();
        let Some(pip_cost) =
            group_action_pip_cost_with_indexes(indexes, &group_units, "group_charge", &paths)
        else {
            continue;
        };
        if pip_cost > state.pips_remaining {
            continue;
        }
        let warning = group_charge_warning(state, indexes, &steps);
        actions.push(LegalAction::GroupCharge {
            unit_ids: group_unit_ids.to_vec(),
            steps,
            pip_cost,
            warning,
        });
    }

    actions
}

pub(crate) fn group_is_enumerated(
    state: &GameState,
    indexes: &GameIndexes,
    group_unit_ids: &[String],
) -> bool {
    enumerate_groups_with_indexes(state, indexes)
        .into_iter()
        .any(|candidate| candidate.as_slice() == group_unit_ids)
}

pub(crate) fn group_units_for_ids<'a>(
    state: &'a GameState,
    indexes: &'a GameIndexes,
    group_unit_ids: &[String],
) -> Option<Vec<&'a Unit>> {
    let group_units: Vec<&Unit> = group_unit_ids
        .iter()
        .filter_map(|unit_id| indexes.find_unit(state, unit_id))
        .collect();
    (group_units.len() == group_unit_ids.len()).then_some(group_units)
}

pub(crate) fn group_charge_warning(
    state: &GameState,
    indexes: &GameIndexes,
    steps: &[crate::types::GroupChargeStep],
) -> Option<String> {
    for step in steps {
        let Some(attacker) = indexes.find_unit(state, &step.unit_id) else {
            continue;
        };
        let Some(defender) = indexes.find_unit(state, &step.target_id) else {
            continue;
        };
        if ordered_pike_charge_warning_with_indexes(attacker, defender, "front", state, indexes)
            .is_some()
        {
            return Some(
                "Charging an OrderedPike front will cancel shock and may trigger elephant/chariot panic."
                    .to_string(),
            );
        }
    }
    None
}

pub(crate) fn dedupe_legal_actions(actions: Vec<LegalAction>) -> Vec<LegalAction> {
    let mut keep = vec![false; actions.len()];
    {
        let mut seen = HashSet::with_capacity(actions.len());
        for (index, action) in actions.iter().enumerate() {
            if seen.insert(LegalActionKey::from(action)) {
                keep[index] = true;
            }
        }
    }
    actions
        .into_iter()
        .zip(keep)
        .filter_map(|(action, keep)| keep.then_some(action))
        .collect()
}

#[derive(Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) enum LegalActionKey<'a> {
    Deploy {
        unit_id: &'a str,
        destination: &'a Coord,
    },
    Move {
        unit_id: &'a str,
        destination: &'a Coord,
        path: &'a [Coord],
        facing: &'a Direction,
        pip_cost: i32,
    },
    MarchMove {
        unit_id: &'a str,
        destination: &'a Coord,
        path: &'a [Coord],
        facing: &'a Direction,
        pip_cost: i32,
    },
    Charge {
        unit_id: &'a str,
        target_id: &'a str,
        destination: &'a Coord,
        path: &'a [Coord],
        facing: &'a Direction,
        aspect: &'a str,
        pip_cost: i32,
        warning: Option<&'a str>,
    },
    GroupMove {
        unit_ids: &'a [String],
        steps: &'a [crate::types::GroupMoveStep],
        pip_cost: i32,
    },
    GroupMarchMove {
        unit_ids: &'a [String],
        steps: &'a [crate::types::GroupMoveStep],
        pip_cost: i32,
    },
    GroupCharge {
        unit_ids: &'a [String],
        steps: &'a [crate::types::GroupChargeStep],
        pip_cost: i32,
        warning: Option<&'a str>,
    },
    Rotate {
        unit_id: &'a str,
        facing: &'a Direction,
        pip_cost: i32,
    },
    Shoot {
        unit_id: &'a str,
        target_id: &'a str,
        range: i32,
        pip_cost: i32,
    },
    Rally {
        unit_id: &'a str,
        pip_cost: i32,
    },
    ReformPike {
        unit_id: &'a str,
        pip_cost: i32,
    },
    FinalizeDeployment,
    EndBound,
}

impl<'a> From<&'a LegalAction> for LegalActionKey<'a> {
    fn from(action: &'a LegalAction) -> Self {
        match action {
            LegalAction::Deploy {
                unit_id,
                destination,
            } => Self::Deploy {
                unit_id,
                destination,
            },
            LegalAction::Move {
                unit_id,
                destination,
                path,
                facing,
                pip_cost,
            } => Self::Move {
                unit_id,
                destination,
                path,
                facing,
                pip_cost: *pip_cost,
            },
            LegalAction::MarchMove {
                unit_id,
                destination,
                path,
                facing,
                pip_cost,
            } => Self::MarchMove {
                unit_id,
                destination,
                path,
                facing,
                pip_cost: *pip_cost,
            },
            LegalAction::Charge {
                unit_id,
                target_id,
                destination,
                path,
                facing,
                aspect,
                pip_cost,
                warning,
            } => Self::Charge {
                unit_id,
                target_id,
                destination,
                path,
                facing,
                aspect,
                pip_cost: *pip_cost,
                warning: warning.as_deref(),
            },
            LegalAction::GroupMove {
                unit_ids,
                steps,
                pip_cost,
            } => Self::GroupMove {
                unit_ids,
                steps,
                pip_cost: *pip_cost,
            },
            LegalAction::GroupMarchMove {
                unit_ids,
                steps,
                pip_cost,
            } => Self::GroupMarchMove {
                unit_ids,
                steps,
                pip_cost: *pip_cost,
            },
            LegalAction::GroupCharge {
                unit_ids,
                steps,
                pip_cost,
                warning,
            } => Self::GroupCharge {
                unit_ids,
                steps,
                pip_cost: *pip_cost,
                warning: warning.as_deref(),
            },
            LegalAction::Rotate {
                unit_id,
                facing,
                pip_cost,
            } => Self::Rotate {
                unit_id,
                facing,
                pip_cost: *pip_cost,
            },
            LegalAction::Shoot {
                unit_id,
                target_id,
                range,
                pip_cost,
            } => Self::Shoot {
                unit_id,
                target_id,
                range: *range,
                pip_cost: *pip_cost,
            },
            LegalAction::Rally { unit_id, pip_cost } => Self::Rally {
                unit_id,
                pip_cost: *pip_cost,
            },
            LegalAction::ReformPike { unit_id, pip_cost } => Self::ReformPike {
                unit_id,
                pip_cost: *pip_cost,
            },
            LegalAction::FinalizeDeployment => Self::FinalizeDeployment,
            LegalAction::EndBound => Self::EndBound,
        }
    }
}

pub(crate) fn sort_legal_actions(actions: &mut [LegalAction]) {
    actions.sort_by(|left, right| {
        action_sort_key(left)
            .cmp(&action_sort_key(right))
            .then_with(|| action_sort_fallback(left).cmp(&action_sort_fallback(right)))
    });
}

pub(crate) fn action_sort_key(action: &LegalAction) -> (i32, i32, i32, i32) {
    (
        action_kind_priority(action),
        -action_group_size(action),
        action_pip_cost_for_sort(action),
        -action_path_length(action),
    )
}

pub(crate) fn action_kind_priority(action: &LegalAction) -> i32 {
    match action {
        LegalAction::Deploy { .. } => 0,
        LegalAction::FinalizeDeployment => 1,
        LegalAction::GroupCharge { .. } => 10,
        LegalAction::Charge { .. } => 11,
        LegalAction::Shoot { .. } => 12,
        LegalAction::Rally { .. } | LegalAction::ReformPike { .. } => 13,
        LegalAction::GroupMarchMove { .. } => 20,
        LegalAction::GroupMove { .. } => 21,
        LegalAction::MarchMove { .. } => 30,
        LegalAction::Move { .. } => 31,
        LegalAction::Rotate { .. } => 40,
        LegalAction::EndBound => 90,
    }
}

pub(crate) fn action_group_size(action: &LegalAction) -> i32 {
    match action {
        LegalAction::GroupMove { unit_ids, .. }
        | LegalAction::GroupMarchMove { unit_ids, .. }
        | LegalAction::GroupCharge { unit_ids, .. } => unit_ids.len() as i32,
        LegalAction::EndBound | LegalAction::FinalizeDeployment => 0,
        _ => 1,
    }
}

pub(crate) fn action_pip_cost_for_sort(action: &LegalAction) -> i32 {
    match action {
        LegalAction::Move { pip_cost, .. }
        | LegalAction::MarchMove { pip_cost, .. }
        | LegalAction::Charge { pip_cost, .. }
        | LegalAction::GroupMove { pip_cost, .. }
        | LegalAction::GroupMarchMove { pip_cost, .. }
        | LegalAction::GroupCharge { pip_cost, .. }
        | LegalAction::Rotate { pip_cost, .. }
        | LegalAction::Shoot { pip_cost, .. }
        | LegalAction::Rally { pip_cost, .. }
        | LegalAction::ReformPike { pip_cost, .. } => *pip_cost,
        LegalAction::Deploy { .. } | LegalAction::FinalizeDeployment | LegalAction::EndBound => 0,
    }
}

pub(crate) fn action_path_length(action: &LegalAction) -> i32 {
    match action {
        LegalAction::Move { path, .. }
        | LegalAction::MarchMove { path, .. }
        | LegalAction::Charge { path, .. } => path.len() as i32,
        LegalAction::GroupMove { steps, .. } | LegalAction::GroupMarchMove { steps, .. } => steps
            .iter()
            .map(|step| step.path.len() as i32)
            .max()
            .unwrap_or(0),
        LegalAction::GroupCharge { steps, .. } => steps
            .iter()
            .map(|step| step.path.len() as i32)
            .max()
            .unwrap_or(0),
        LegalAction::Deploy { .. }
        | LegalAction::Rotate { .. }
        | LegalAction::Shoot { .. }
        | LegalAction::Rally { .. }
        | LegalAction::ReformPike { .. }
        | LegalAction::FinalizeDeployment
        | LegalAction::EndBound => 0,
    }
}

pub(crate) fn action_sort_fallback(action: &LegalAction) -> LegalActionKey<'_> {
    LegalActionKey::from(action)
}

pub(crate) fn dedupe_and_sort(actions: Vec<LegalAction>) -> Vec<LegalAction> {
    let mut deduped = dedupe_legal_actions(actions);
    sort_legal_actions(&mut deduped);
    deduped
}
