use super::*;

pub fn build_compact_action_history(action_history: &[Action]) -> String {
    if action_history.is_empty() {
        return "ACT -".to_string();
    }
    action_history
        .iter()
        .enumerate()
        .map(|(index, action)| format!("ACT {} {}", index + 1, compact_action(action)))
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn build_compact_action_history_tail(action_history: &[Action]) -> String {
    if action_history.len() <= STRICT_BENCHMARK_ACTION_HISTORY_LIMIT {
        return build_compact_action_history(action_history);
    }
    let tail = &action_history[action_history.len() - STRICT_BENCHMARK_ACTION_HISTORY_LIMIT..];
    let earlier_count = action_history.len() - tail.len();
    let mut lines = vec![format!(
        "ACTTRUNC earlier={} showing={}",
        earlier_count,
        tail.len()
    )];
    lines.extend(tail.iter().enumerate().map(|(offset, action)| {
        format!(
            "ACT {} {}",
            earlier_count + offset + 1,
            compact_action(action)
        )
    }));
    lines.join("\n")
}

pub fn build_compact_action_history_tail_perspective(
    state: &crate::types::GameState,
    viewer: &ArmyId,
    action_history: &[Action],
) -> String {
    if action_history.len() <= STRICT_BENCHMARK_ACTION_HISTORY_LIMIT {
        return build_compact_action_history_perspective(state, viewer, action_history);
    }
    let tail = &action_history[action_history.len() - STRICT_BENCHMARK_ACTION_HISTORY_LIMIT..];
    let earlier_count = action_history.len() - tail.len();
    let mut lines = vec![format!(
        "ACTTRUNC earlier={} showing={}",
        earlier_count,
        tail.len()
    )];
    lines.extend(tail.iter().enumerate().map(|(offset, action)| {
        format!(
            "ACT {} {}",
            earlier_count + offset + 1,
            compact_action_perspective(state, viewer, action)
        )
    }));
    lines.join("\n")
}

pub fn build_compact_action_history_perspective(
    state: &crate::types::GameState,
    viewer: &ArmyId,
    action_history: &[Action],
) -> String {
    if action_history.is_empty() {
        return "ACT -".to_string();
    }
    action_history
        .iter()
        .enumerate()
        .map(|(index, action)| {
            format!(
                "ACT {} {}",
                index + 1,
                compact_action_perspective(state, viewer, action)
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn build_last_action_result(
    state: &crate::types::GameState,
    action_history: &[Action],
) -> String {
    let Some(action) = action_history.last() else {
        return "- none yet.".to_string();
    };
    match action {
        Action::Deploy {
            unit_id,
            destination,
        } => {
            let facing = find_unit(state, unit_id)
                .map(|unit| unit.facing.to_string())
                .unwrap_or_else(|| "?".to_string());
            format!(
                "- deploy {unit_id}: now at {} facing {facing}.",
                coord_token(destination)
            )
        }
        Action::Move {
            unit_id,
            destination,
            facing,
            ..
        } => format!(
            "- move {unit_id}: now at {} facing {facing}.",
            coord_token(destination)
        ),
        Action::MarchMove {
            unit_id,
            destination,
            facing,
            ..
        } => format!(
            "- march {unit_id}: now at {} facing {facing}.",
            coord_token(destination)
        ),
        Action::Charge {
            unit_id,
            target_id,
            destination,
            facing,
            ..
        } => build_last_charge_result(state, unit_id, target_id, destination, facing),
        Action::GroupMove { unit_ids, steps } => format!(
            "- group_move {}: {}.",
            unit_ids.join(","),
            summarize_group_step_results(steps)
        ),
        Action::GroupMarchMove { unit_ids, steps } => format!(
            "- group_march_move {}: {}.",
            unit_ids.join(","),
            summarize_group_step_results(steps)
        ),
        Action::GroupCharge { unit_ids, steps } => {
            build_last_group_charge_result(state, unit_ids, steps)
        }
        Action::Rotate { unit_id, facing } => {
            format!("- rotate {unit_id}: now facing {facing}.")
        }
        Action::Shoot { unit_id, target_id } => build_last_shoot_result(state, unit_id, target_id),
        Action::Rally { unit_id } => format!("- rally {unit_id}: disorder cleared."),
        Action::ReformPike { unit_id } => {
            format!("- reform_pike {unit_id}: formation is now OrderedPike.")
        }
        Action::FinalizeDeployment => build_last_finalize_deployment_result(state),
        Action::EndBound => build_last_end_bound_result(state),
    }
}

pub fn build_last_action_result_perspective(
    state: &crate::types::GameState,
    viewer: &ArmyId,
    action_history: &[Action],
) -> String {
    perspective_result_text(
        viewer,
        state,
        &build_last_action_result(state, action_history),
    )
}

pub(crate) fn perspective_result_text(
    viewer: &ArmyId,
    state: &crate::types::GameState,
    text: &str,
) -> String {
    let mut replacements: Vec<(String, String)> = Vec::new();
    let mut units = state.units.clone();
    units.sort_by(|left, right| {
        right
            .id
            .len()
            .cmp(&left.id.len())
            .then(left.id.cmp(&right.id))
    });
    for unit in units {
        replacements.push((unit.id.clone(), perspective_unit_id(viewer, &unit.id)));
    }

    for army in [ArmyId::A, ArmyId::B] {
        let army_text = army.to_string();
        let local_text = perspective_army_token(viewer, &army).to_string();
        replacements.push((format!("- {army_text} "), format!("- {local_text} ")));
        replacements.push((format!(" {army_text} "), format!(" {local_text} ")));
        replacements.push((format!(": {army_text} "), format!(": {local_text} ")));
    }

    for y in 0..state.board_height {
        for x in 0..state.board_width {
            let coord = Coord { x, y };
            let local = perspective_coord(state, viewer, &coord);
            replacements.push((
                format!("({}, {})", coord.x, coord.y),
                format!("({}, {})", local.x, local.y),
            ));
            replacements.push((coord_token(&coord), coord_token(&local)));
        }
    }

    if *viewer == ArmyId::B {
        for (from, to) in [
            ("facing N", "facing S"),
            ("facing S", "facing N"),
            ("facing E", "facing W"),
            ("facing W", "facing E"),
        ] {
            replacements.push((from.to_string(), to.to_string()));
        }
    }

    replacements.sort_by(|left, right| right.0.len().cmp(&left.0.len()));
    let mut output = text.to_string();
    let mut placeholders = Vec::new();
    for (index, (from, to)) in replacements.into_iter().enumerate() {
        if from == to || !output.contains(&from) {
            continue;
        }
        let placeholder = format!("__PHALANX_PERSPECTIVE_{index}__");
        output = output.replace(&from, &placeholder);
        placeholders.push((placeholder, to));
    }
    for (placeholder, to) in placeholders {
        output = output.replace(&placeholder, &to);
    }
    output
}

pub fn build_immediate_action_effects(
    state: &crate::types::GameState,
    legal_actions: &[LegalAction],
) -> String {
    if legal_actions.is_empty() {
        return "EFF -".to_string();
    }
    legal_actions
        .iter()
        .enumerate()
        .map(|(index, action)| format!("EFF {} {}", index, immediate_action_effect(state, action)))
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn short_immediate_effect(
    state: &crate::types::GameState,
    action: &LegalAction,
) -> &'static str {
    match action {
        LegalAction::Deploy { .. } => "place",
        LegalAction::Move { unit_id, .. } => {
            if move_breaks_contact(state, unit_id) {
                "move_now+breakoff"
            } else {
                "move_now"
            }
        }
        LegalAction::MarchMove { .. } => "move_now",
        LegalAction::Charge {
            unit_id,
            target_id,
            destination,
            facing,
            ..
        } => {
            if let (Some(attacker), Some(defender)) =
                (find_unit(state, unit_id), find_unit(state, target_id))
            {
                let moved_attacker = Unit {
                    position: destination.clone(),
                    facing: facing.clone(),
                    ..attacker.clone()
                };
                if charge_evade_preview(state, defender, &moved_attacker).is_some() {
                    return "move_now+evade";
                }
            }
            "move_now+contact"
        }
        LegalAction::GroupMove { .. } | LegalAction::GroupMarchMove { .. } => "group_move_now",
        LegalAction::GroupCharge { .. } => "group_move_now+contacts",
        LegalAction::Rotate { .. } => "face_now",
        LegalAction::Shoot { .. } => "shoot_end_bound",
        LegalAction::Rally { .. } => "clear_disorder",
        LegalAction::ReformPike { .. } => "OrderedPike",
        LegalAction::FinalizeDeployment => "ready_or_battle",
        LegalAction::EndBound => "resolve_bound",
    }
}

pub(crate) fn immediate_action_effect(
    state: &crate::types::GameState,
    action: &LegalAction,
) -> String {
    match action {
        LegalAction::Deploy {
            unit_id,
            destination,
        } => {
            let facing = find_unit(state, unit_id)
                .map(|unit| unit.facing.to_string())
                .unwrap_or_else(|| "?".to_string());
            format!(
                "{unit_id} is placed at {} facing {facing}; no combat or dice resolve now.",
                coord_token(destination)
            )
        }
        LegalAction::Move {
            unit_id,
            destination,
            facing,
            ..
        } => {
            if move_breaks_contact(state, unit_id) {
                format!(
                    "{unit_id} immediately breaks off from enemy contact to {} facing {}, activates, and becomes disordered; no combat or dice resolve now.",
                    coord_token(destination),
                    facing
                )
            } else {
                format!(
                    "{unit_id} immediately ends at {} facing {}; no combat or dice resolve now.",
                    coord_token(destination),
                    facing
                )
            }
        }
        LegalAction::MarchMove {
            unit_id,
            destination,
            facing,
            ..
        } => format!(
            "{unit_id} immediately ends at {} facing {}; no combat or dice resolve now.",
            coord_token(destination),
            facing
        ),
        LegalAction::Charge {
            unit_id,
            target_id,
            destination,
            facing,
            ..
        } => describe_charge_immediate_effect(state, unit_id, target_id, destination, facing),
        LegalAction::GroupMove { unit_ids, .. } => format!(
            "All listed units immediately move to their step destinations and activate; no combat or dice resolve now ({}).",
            unit_ids.join(", ")
        ),
        LegalAction::GroupMarchMove { unit_ids, .. } => format!(
            "All listed units immediately march to their step destinations and activate; no combat or dice resolve now ({}).",
            unit_ids.join(", ")
        ),
        LegalAction::GroupCharge { steps, .. } => describe_group_charge_immediate_effect(state, steps),
        LegalAction::Rotate {
            unit_id, facing, ..
        } => format!(
            "{unit_id} immediately rotates to {facing} and activates; no combat or dice resolve now."
        ),
        LegalAction::Shoot {
            unit_id,
            target_id,
            range,
            ..
        } => format!(
            "{unit_id} queues missile fire at {target_id} at range {range}; it spends PIPs and activates now, but missile dice and effects resolve at end_bound before close combat."
        ),
        LegalAction::Rally { unit_id, .. } => {
            format!("{unit_id} immediately rallies, clears disorder, spends PIPs, and activates.")
        }
        LegalAction::ReformPike { unit_id, .. } => {
            format!("{unit_id} immediately reforms into OrderedPike, clears disorder, spends PIPs, and activates.")
        }
        LegalAction::FinalizeDeployment => describe_finalize_deployment_immediate_effect(state),
        LegalAction::EndBound => describe_end_bound_immediate_effect(state),
    }
}

pub(crate) fn move_breaks_contact(state: &crate::types::GameState, unit_id: &str) -> bool {
    find_unit(state, unit_id).is_some_and(|unit| {
        unit.can_evade && !unit.disordered && !adjacent_enemies(state, unit).is_empty()
    })
}

pub(crate) fn describe_charge_immediate_effect(
    state: &crate::types::GameState,
    unit_id: &str,
    target_id: &str,
    destination: &Coord,
    facing: &crate::types::Direction,
) -> String {
    let Some(attacker) = find_unit(state, unit_id) else {
        return format!(
            "{unit_id} immediately charges to {} facing {}; close combat, if any, resolves only at end_bound.",
            coord_token(destination),
            facing
        );
    };
    let Some(defender) = find_unit(state, target_id) else {
        return format!(
            "{unit_id} immediately charges to {} facing {}; close combat, if any, resolves only at end_bound.",
            coord_token(destination),
            facing
        );
    };
    let moved_attacker = Unit {
        position: destination.clone(),
        facing: facing.clone(),
        ..attacker.clone()
    };
    if let Some(path) = charge_evade_preview(state, defender, &moved_attacker) {
        let final_position = path
            .last()
            .cloned()
            .unwrap_or_else(|| defender.position.clone());
        return format!(
            "{unit_id} immediately moves to {} facing {}; {target_id} immediately evades from {} to {} via {} and becomes disordered, so this charge creates no close combat now.",
            coord_token(destination),
            facing,
            coord_token(&defender.position),
            coord_token(&final_position),
            format_path(&path)
        );
    }
    format!(
        "{unit_id} immediately moves into contact with {target_id} at {} facing {}; it gains Charging until the end_bound close combat resolution, which still does not resolve now.",
        coord_token(destination),
        facing
    )
}

pub(crate) fn describe_group_charge_immediate_effect(
    state: &crate::types::GameState,
    steps: &[GroupChargeStep],
) -> String {
    let mut parts = Vec::new();
    for step in steps {
        let Some(attacker) = find_unit(state, &step.unit_id) else {
            parts.push(format!(
                "{} moves to {} facing {} against {}; close combat resolves only at end_bound.",
                step.unit_id,
                coord_token(&step.destination),
                step.facing,
                step.target_id
            ));
            continue;
        };
        let Some(defender) = find_unit(state, &step.target_id) else {
            parts.push(format!(
                "{} moves to {} facing {} against {}; close combat resolves only at end_bound.",
                step.unit_id,
                coord_token(&step.destination),
                step.facing,
                step.target_id
            ));
            continue;
        };
        let moved_attacker = Unit {
            position: step.destination.clone(),
            facing: step.facing.clone(),
            ..attacker.clone()
        };
        if let Some(path) = charge_evade_preview(state, defender, &moved_attacker) {
            let final_position = path
                .last()
                .cloned()
                .unwrap_or_else(|| defender.position.clone());
            parts.push(format!(
                "{} moves to {}; {} evades {} -> {} via {} and becomes disordered",
                step.unit_id,
                coord_token(&step.destination),
                step.target_id,
                coord_token(&defender.position),
                coord_token(&final_position),
                format_path(&path)
            ));
        } else {
            parts.push(format!(
                "{} moves into contact with {} at {}; it gains Charging until end_bound close combat",
                step.unit_id,
                step.target_id,
                coord_token(&step.destination)
            ));
        }
    }
    format!("Group charge immediate effects: {}.", parts.join("; "))
}

pub(crate) fn describe_finalize_deployment_immediate_effect(
    state: &crate::types::GameState,
) -> String {
    let will_start_battle = !state.deployment_ready.contains(&state.current_player)
        && state.deployment_ready.len() + 1 == 2;
    if will_start_battle {
        format!(
            "Current army is marked ready; both armies will then be ready, so battle immediately begins with A on bound 1 with {} PIPs.",
            FIXED_PIPS_PER_BOUND
        )
    } else {
        format!(
            "Current army is marked ready for deployment; if both armies are not yet ready, deployment immediately passes to {}.",
            state.current_player.other()
        )
    }
}

pub(crate) fn describe_end_bound_immediate_effect(state: &crate::types::GameState) -> String {
    let engagements = build_combat_pairs(state);
    let contact_token = if engagements.is_empty() {
        "no close combats are currently in contact".to_string()
    } else {
        let labels = engagements
            .iter()
            .map(|engagement| format!("{} vs {}", engagement.attacker_id, engagement.defender_id))
            .collect::<Vec<_>>()
            .join(", ");
        format!("current close combats resolving now: {labels}")
    };
    format!(
        "{contact_token}; exact combat dice are not shown in advance. Then play passes to {} on bound {} with {} PIPs, all units reset activation, eligible disorder rallies, and command status refreshes.",
        state.current_player.other(),
        state.bound_number + 1,
        FIXED_PIPS_PER_BOUND
    )
}

pub fn compact_action(action: &Action) -> String {
    match action {
        Action::Deploy {
            unit_id,
            destination,
        } => {
            format!("deploy {unit_id}->{}", coord_token(destination))
        }
        Action::Move {
            unit_id,
            destination,
            path,
            facing,
        } => format!(
            "move {unit_id}->{} f{} p[{}]",
            coord_token(destination),
            facing,
            path_token(path)
        ),
        Action::MarchMove {
            unit_id,
            destination,
            path,
            facing,
        } => format!(
            "march {unit_id}->{} f{} p[{}]",
            coord_token(destination),
            facing,
            path_token(path)
        ),
        Action::Charge {
            unit_id,
            target_id,
            destination,
            path,
            facing,
        } => format!(
            "charge {unit_id}->{target_id} @{} f{} p[{}]",
            coord_token(destination),
            facing,
            path_token(path)
        ),
        Action::GroupMove { unit_ids, steps } => {
            format!(
                "gmove [{}] {{{}}}",
                unit_ids.join(","),
                compact_group_steps(steps)
            )
        }
        Action::GroupMarchMove { unit_ids, steps } => {
            format!(
                "gmarch [{}] {{{}}}",
                unit_ids.join(","),
                compact_group_steps(steps)
            )
        }
        Action::GroupCharge { unit_ids, steps } => {
            format!(
                "gcharge [{}] {{{}}}",
                unit_ids.join(","),
                compact_group_charge_steps(steps)
            )
        }
        Action::Rotate { unit_id, facing } => format!("rotate {unit_id}->{facing}"),
        Action::Shoot { unit_id, target_id } => format!("shoot {unit_id}->{target_id}"),
        Action::Rally { unit_id } => format!("rally {unit_id}"),
        Action::ReformPike { unit_id } => format!("reform_pike {unit_id}"),
        Action::FinalizeDeployment => "finalize_deployment".to_string(),
        Action::EndBound => "end_bound".to_string(),
    }
}

pub fn compact_action_perspective(
    state: &crate::types::GameState,
    viewer: &ArmyId,
    action: &Action,
) -> String {
    match action {
        Action::Deploy {
            unit_id,
            destination,
        } => {
            format!(
                "deploy {}->{}",
                perspective_unit_id(viewer, unit_id),
                perspective_coord_token(state, viewer, destination)
            )
        }
        Action::Move {
            unit_id,
            destination,
            path,
            facing,
        } => format!(
            "move {}->{} f{} p[{}]",
            perspective_unit_id(viewer, unit_id),
            perspective_coord_token(state, viewer, destination),
            perspective_direction_token(viewer, facing),
            path_token_perspective(state, viewer, path)
        ),
        Action::MarchMove {
            unit_id,
            destination,
            path,
            facing,
        } => format!(
            "march {}->{} f{} p[{}]",
            perspective_unit_id(viewer, unit_id),
            perspective_coord_token(state, viewer, destination),
            perspective_direction_token(viewer, facing),
            path_token_perspective(state, viewer, path)
        ),
        Action::Charge {
            unit_id,
            target_id,
            destination,
            path,
            facing,
        } => format!(
            "charge {}->{} @{} f{} p[{}]",
            perspective_unit_id(viewer, unit_id),
            perspective_unit_id(viewer, target_id),
            perspective_coord_token(state, viewer, destination),
            perspective_direction_token(viewer, facing),
            path_token_perspective(state, viewer, path)
        ),
        Action::GroupMove { unit_ids, steps } => {
            format!(
                "gmove [{}] {{{}}}",
                unit_ids
                    .iter()
                    .map(|unit_id| perspective_unit_id(viewer, unit_id))
                    .collect::<Vec<_>>()
                    .join(","),
                compact_group_steps_perspective(state, viewer, steps)
            )
        }
        Action::GroupMarchMove { unit_ids, steps } => {
            format!(
                "gmarch [{}] {{{}}}",
                unit_ids
                    .iter()
                    .map(|unit_id| perspective_unit_id(viewer, unit_id))
                    .collect::<Vec<_>>()
                    .join(","),
                compact_group_steps_perspective(state, viewer, steps)
            )
        }
        Action::GroupCharge { unit_ids, steps } => {
            format!(
                "gcharge [{}] {{{}}}",
                unit_ids
                    .iter()
                    .map(|unit_id| perspective_unit_id(viewer, unit_id))
                    .collect::<Vec<_>>()
                    .join(","),
                compact_group_charge_steps_perspective(state, viewer, steps)
            )
        }
        Action::Rotate { unit_id, facing } => format!(
            "rotate {}->{}",
            perspective_unit_id(viewer, unit_id),
            perspective_direction_token(viewer, facing)
        ),
        Action::Shoot { unit_id, target_id } => format!(
            "shoot {}->{}",
            perspective_unit_id(viewer, unit_id),
            perspective_unit_id(viewer, target_id)
        ),
        Action::Rally { unit_id } => format!("rally {}", perspective_unit_id(viewer, unit_id)),
        Action::ReformPike { unit_id } => {
            format!("reform_pike {}", perspective_unit_id(viewer, unit_id))
        }
        Action::FinalizeDeployment => "finalize_deployment".to_string(),
        Action::EndBound => "end_bound".to_string(),
    }
}

pub fn compact_group_steps(steps: &[GroupMoveStep]) -> String {
    steps
        .iter()
        .map(|step| {
            format!(
                "{}->{}:{}:p[{}]",
                step.unit_id,
                coord_token(&step.destination),
                step.facing,
                path_token(&step.path)
            )
        })
        .collect::<Vec<_>>()
        .join(";")
}

pub fn compact_group_steps_perspective(
    state: &crate::types::GameState,
    viewer: &ArmyId,
    steps: &[GroupMoveStep],
) -> String {
    steps
        .iter()
        .map(|step| {
            format!(
                "{}->{}:{}:p[{}]",
                perspective_unit_id(viewer, &step.unit_id),
                perspective_coord_token(state, viewer, &step.destination),
                perspective_direction_token(viewer, &step.facing),
                path_token_perspective(state, viewer, &step.path)
            )
        })
        .collect::<Vec<_>>()
        .join(";")
}

pub fn compact_group_charge_steps(steps: &[GroupChargeStep]) -> String {
    steps
        .iter()
        .map(|step| {
            format!(
                "{}->{}@{}:{}:p[{}]",
                step.unit_id,
                step.target_id,
                coord_token(&step.destination),
                step.facing,
                path_token(&step.path)
            )
        })
        .collect::<Vec<_>>()
        .join(";")
}

pub fn compact_group_charge_steps_perspective(
    state: &crate::types::GameState,
    viewer: &ArmyId,
    steps: &[GroupChargeStep],
) -> String {
    steps
        .iter()
        .map(|step| {
            format!(
                "{}->{}@{}:{}:p[{}]",
                perspective_unit_id(viewer, &step.unit_id),
                perspective_unit_id(viewer, &step.target_id),
                perspective_coord_token(state, viewer, &step.destination),
                perspective_direction_token(viewer, &step.facing),
                path_token_perspective(state, viewer, &step.path)
            )
        })
        .collect::<Vec<_>>()
        .join(";")
}

pub fn build_compact_resolution_tail(resolutions: &[CombatResolution]) -> String {
    if resolutions.is_empty() {
        return "RES -".to_string();
    }
    resolutions
        .iter()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(|resolution| {
            let kind = if resolution.kind.to_string() == "missile" {
                "MS"
            } else {
                "CC"
            };
            let aspect = resolution
                .aspect
                .as_ref()
                .map(|value| format!(" asp={value}"))
                .unwrap_or_default();
            let range = resolution
                .range
                .map(|value| format!(" r={value}"))
                .unwrap_or_default();
            format!(
                "RES {kind} {}>{} {}:{} {}{}{range}",
                resolution.attacker_id,
                resolution.defender_id,
                resolution.attacker_total,
                resolution.defender_total,
                resolution.outcome,
                aspect
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn build_compact_event_tail(log_entries: &[LogEntry]) -> String {
    if log_entries.is_empty() {
        return "EVT -".to_string();
    }
    log_entries
        .iter()
        .rev()
        .take(8)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(|entry| format!("EVT {} {}", entry.step, compact_text(&entry.message)))
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn coord_token(coord: &Coord) -> String {
    format!("{},{}", coord.x, coord.y)
}

pub fn path_token(path: &[Coord]) -> String {
    if path.is_empty() {
        "-".to_string()
    } else {
        path.iter().map(coord_token).collect::<Vec<_>>().join(">")
    }
}

pub fn path_token_perspective(
    state: &crate::types::GameState,
    viewer: &ArmyId,
    path: &[Coord],
) -> String {
    if path.is_empty() {
        "-".to_string()
    } else {
        path.iter()
            .map(|coord| perspective_coord_token(state, viewer, coord))
            .collect::<Vec<_>>()
            .join(">")
    }
}

pub fn compact_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(crate) fn build_last_charge_result(
    state: &crate::types::GameState,
    unit_id: &str,
    target_id: &str,
    destination: &Coord,
    facing: &crate::types::Direction,
) -> String {
    let action_logs = last_action_log_entries(
        &state.log,
        &Action::Charge {
            unit_id: unit_id.to_string(),
            target_id: target_id.to_string(),
            destination: destination.clone(),
            path: Vec::new(),
            facing: facing.clone(),
        },
    );
    if let Some(entry) = action_logs
        .iter()
        .find(|entry| entry.message.contains(" evaded from "))
    {
        return format!(
            "- charge {unit_id}->{target_id}: {}.",
            normalize_log_message(&entry.message)
        );
    }
    if let Some(entry) = action_logs
        .iter()
        .find(|entry| entry.message.contains(" conformed from "))
    {
        return format!(
            "- charge {unit_id}->{target_id}: {}; attacker is Charging and close combat remains pending until end_bound.",
            normalize_log_message(&entry.message)
        );
    }
    format!(
        "- charge {unit_id}->{target_id}: attacker entered contact at {} facing {facing}, gained Charging, and close combat remains pending until end_bound.",
        coord_token(destination)
    )
}

pub(crate) fn build_last_group_charge_result(
    state: &crate::types::GameState,
    unit_ids: &[String],
    steps: &[GroupChargeStep],
) -> String {
    let action_logs = last_action_log_entries(
        &state.log,
        &Action::GroupCharge {
            unit_ids: unit_ids.to_vec(),
            steps: steps.to_vec(),
        },
    );
    let consequence_lines = action_logs
        .iter()
        .filter(|entry| {
            entry.message.contains(" evaded from ") || entry.message.contains(" conformed from ")
        })
        .map(|entry| format!("- {}", normalize_log_message(&entry.message)))
        .collect::<Vec<_>>();
    if !consequence_lines.is_empty() {
        return consequence_lines.join("\n");
    }
    format!(
        "- group_charge {}: units that made contact gained Charging; close combat remains pending until end_bound.",
        unit_ids.join(",")
    )
}

pub(crate) fn build_last_shoot_result(
    state: &crate::types::GameState,
    unit_id: &str,
    target_id: &str,
) -> String {
    if let Some(resolution) = state.recent_resolutions.iter().rev().find(|resolution| {
        resolution.kind == CombatKind::Missile
            && resolution.attacker_id == unit_id
            && resolution.defender_id == target_id
    }) {
        return format!(
            "- shoot {unit_id}->{target_id}: {}.",
            summarize_resolution_effect(state, resolution)
        );
    }
    let action_logs = last_action_log_entries(
        &state.log,
        &Action::Shoot {
            unit_id: unit_id.to_string(),
            target_id: target_id.to_string(),
        },
    );
    if let Some(entry) = action_logs.iter().find(|entry| {
        entry.message.contains(" prepared missile fire at ") || entry.message.contains(" shot at ")
    }) {
        return format!(
            "- shoot {unit_id}->{target_id}: {}.",
            normalize_log_message(&entry.message)
        );
    }
    if state
        .pending_shots
        .iter()
        .any(|shot| shot.unit_id == unit_id && shot.target_id == target_id)
    {
        return format!("- shoot {unit_id}->{target_id}: missile fire was queued for end_bound.");
    }
    format!("- shoot {unit_id}->{target_id}: missile fire was queued for end_bound.")
}

pub(crate) fn build_last_finalize_deployment_result(state: &crate::types::GameState) -> String {
    if state.phase == crate::types::GamePhase::Battle {
        return format!(
            "- finalize_deployment: battle began; {} to move on bound {} with {} PIPs.",
            state.current_player, state.bound_number, state.pips_remaining
        );
    }
    format!(
        "- finalize_deployment: deployment passed to {}.",
        state.current_player
    )
}

pub(crate) fn build_last_end_bound_result(state: &crate::types::GameState) -> String {
    let mut lines = state
        .recent_resolutions
        .iter()
        .filter(|resolution| resolution.kind == CombatKind::Missile)
        .map(|resolution| {
            format!(
                "- missile {}->{}: {}.",
                resolution.attacker_id,
                resolution.defender_id,
                summarize_resolution_effect(state, resolution)
            )
        })
        .collect::<Vec<_>>();
    let close_lines = state
        .recent_resolutions
        .iter()
        .filter(|resolution| resolution.kind == CombatKind::CloseCombat)
        .map(|resolution| {
            format!(
                "- close combat {}->{}: {}.",
                resolution.attacker_id,
                resolution.defender_id,
                summarize_resolution_effect(state, resolution)
            )
        })
        .collect::<Vec<_>>();
    if close_lines.is_empty() {
        lines.push("- end_bound: no close combats were in contact.".to_string());
    } else {
        lines.extend(close_lines);
    }
    lines.push(format!(
        "- next bound: {} to move with {} PIPs on bound {}.",
        state.current_player, state.pips_remaining, state.bound_number
    ));
    lines.join("\n")
}

pub(crate) fn summarize_group_step_results(steps: &[GroupMoveStep]) -> String {
    steps
        .iter()
        .map(|step| {
            format!(
                "{}@{} {}",
                step.unit_id,
                coord_token(&step.destination),
                step.facing
            )
        })
        .collect::<Vec<_>>()
        .join("; ")
}

pub(crate) fn summarize_resolution_effect(
    state: &crate::types::GameState,
    resolution: &CombatResolution,
) -> String {
    let loser_id = resolution
        .loser_id
        .as_deref()
        .unwrap_or(resolution.defender_id.as_str());
    match resolution.outcome.as_str() {
        "destroy" => format!("{loser_id} was destroyed"),
        "disorder" => format!("{loser_id} became disordered"),
        "recoil" => summarize_displacement_effect(state, resolution, loser_id, "recoiled"),
        "flee" => summarize_displacement_effect(state, resolution, loser_id, "fled"),
        "stand" => "the combat stood with no forced movement".to_string(),
        "no_effect" => "no lasting effect".to_string(),
        other => format!("outcome {other}"),
    }
}

pub(crate) fn summarize_displacement_effect(
    state: &crate::types::GameState,
    resolution: &CombatResolution,
    unit_id: &str,
    verb: &str,
) -> String {
    let before = resolution_position_for_unit(resolution, unit_id);
    let after = find_unit(state, unit_id).map(|unit| unit.position.clone());
    match (before, after) {
        (Some(before), Some(after)) => format!(
            "{unit_id} {verb} {} -> {}",
            coord_token(&before),
            coord_token(&after)
        ),
        _ => format!("{unit_id} {verb}"),
    }
}

pub(crate) fn resolution_position_for_unit(
    resolution: &CombatResolution,
    unit_id: &str,
) -> Option<Coord> {
    if resolution.attacker_id == unit_id {
        Some(resolution.attacker_position.clone())
    } else if resolution.defender_id == unit_id {
        Some(resolution.defender_position.clone())
    } else {
        None
    }
}

pub(crate) fn last_action_log_entries<'a>(
    log_entries: &'a [LogEntry],
    action: &Action,
) -> &'a [LogEntry] {
    let Some(start_index) = log_entries
        .iter()
        .rposition(|entry| log_entry_matches_last_action(&entry.message, action))
    else {
        return &[];
    };
    &log_entries[start_index..]
}

pub(crate) fn log_entry_matches_last_action(message: &str, action: &Action) -> bool {
    match action {
        Action::Deploy { .. } => message.contains(" deployed from "),
        Action::Move { .. } => message.contains(" moved from "),
        Action::MarchMove { .. } => message.contains(" marched from "),
        Action::Charge { .. } => message.contains(" charged from "),
        Action::GroupMove { .. } => message.contains(" group moved "),
        Action::GroupMarchMove { .. } => message.contains(" group marched "),
        Action::GroupCharge { .. } => message.contains(" group charged "),
        Action::Rotate { .. } => message.contains(" rotated from "),
        Action::Shoot { .. } => {
            message.contains(" prepared missile fire at ") || message.contains(" shot at ")
        }
        Action::Rally { .. } => message.contains(" rallied and restored good order."),
        Action::ReformPike { .. } => message.contains(" reformed into OrderedPike."),
        Action::FinalizeDeployment => message.contains(" finalized deployment."),
        Action::EndBound => message.contains(" ended the bound."),
    }
}

pub(crate) fn normalize_log_message(message: &str) -> String {
    compact_text(strip_trailing_period(message))
}

pub(crate) fn strip_trailing_period(message: &str) -> &str {
    message.strip_suffix('.').unwrap_or(message)
}
