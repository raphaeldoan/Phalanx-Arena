use super::*;

pub fn build_compact_state(state: &crate::types::GameState) -> String {
    let attrition_by_army = state
        .attrition_status
        .iter()
        .map(|status| (status.army.clone(), status))
        .collect::<std::collections::HashMap<_, _>>();
    let command_radius_token = [ArmyId::A, ArmyId::B]
        .iter()
        .map(|army| format!("{}:{}", army, command_radius_for_army(state, army)))
        .collect::<Vec<_>>()
        .join(",");
    let mut lines = vec![format!(
        "META scenario={} phase={} bound={} board={}x{} side={} pips={}/{} winner={} target={} cmd={} ready={} endgame={} reason={}",
        state.scenario_id,
        state.phase,
        state.bound_number,
        state.board_width,
        state.board_height,
        state.current_player,
        state.pips_remaining,
        state.last_pip_roll,
        state
            .winner
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "-".to_string()),
        state.victory_target,
        command_radius_token,
        if state.deployment_ready.is_empty() {
            "-".to_string()
        } else {
            state
                .deployment_ready
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join(",")
        },
        state
            .endgame_deadline_bound
            .map(|bound| bound.to_string())
            .unwrap_or_else(|| "-".to_string()),
        compact_text(state.winner_reason.as_deref().unwrap_or("-"))
    )];
    let mut battle_scores = state.battle_scores.clone();
    battle_scores.sort_by(|left, right| left.army.to_string().cmp(&right.army.to_string()));
    let mut armies = state.armies.clone();
    armies.sort_by(|left, right| left.id.to_string().cmp(&right.id.to_string()));
    for army in armies {
        lines.push(format!(
            "ARMY {} morale={}/{} shaken={} broken={} pips={}",
            army.id,
            army.morale_loss,
            army.morale_threshold,
            army.shaken as i32,
            army.broken as i32,
            army.pips
        ));
    }
    for score in battle_scores {
        let attrition_token = attrition_by_army
            .get(&score.army)
            .map(|status| format!("{}/{}", status.losses, status.target_losses))
            .unwrap_or_else(|| "-".to_string());
        lines.push(format!(
            "SCORE {} enemy={} total={} attr={}",
            score.army, score.enemy_losses, score.total, attrition_token
        ));
    }
    let mut deployment_zones = state.deployment_zones.clone();
    deployment_zones.sort_by(|left, right| {
        (left.army.to_string(), left.min_y, left.min_x).cmp(&(
            right.army.to_string(),
            right.min_y,
            right.min_x,
        ))
    });
    for zone in deployment_zones {
        lines.push(format!(
            "ZONE {} x={}-{} y={}-{}",
            zone.army, zone.min_x, zone.max_x, zone.min_y, zone.max_y
        ));
    }
    let mut terrain_tiles = state.terrain.clone();
    terrain_tiles.sort_by(|left, right| {
        (left.position.y, left.position.x, left.terrain.to_string()).cmp(&(
            right.position.y,
            right.position.x,
            right.terrain.to_string(),
        ))
    });
    let terrain_tokens = terrain_tiles
        .into_iter()
        .map(|tile| format!("{}={}", coord_token(&tile.position), tile.terrain))
        .collect::<Vec<_>>();
    lines.push(format!(
        "TERRAIN {}",
        if terrain_tokens.is_empty() {
            "-".to_string()
        } else {
            terrain_tokens.join(";")
        }
    ));
    let mut units = state.units.clone();
    units.sort_by(|left, right| {
        (left.army.to_string(), left.id.clone()).cmp(&(right.army.to_string(), right.id.clone()))
    });
    for unit in &units {
        lines.push(compact_unit_line(unit));
    }
    lines.join("\n")
}

pub fn build_short_state(state: &crate::types::GameState) -> String {
    let mut lines = vec![format!(
        "S scen={} ph={} b={} side={} pip={}/{} board={}x{} win={} ready={}",
        state.scenario_id,
        state.phase,
        state.bound_number,
        state.current_player,
        state.pips_remaining,
        state.last_pip_roll,
        state.board_width,
        state.board_height,
        state
            .winner
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "-".to_string()),
        if state.deployment_ready.is_empty() {
            "-".to_string()
        } else {
            state
                .deployment_ready
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join(",")
        }
    )];
    let morale_tokens = [ArmyId::A, ArmyId::B]
        .iter()
        .filter_map(|army_id| {
            state
                .armies
                .iter()
                .find(|army| &army.id == army_id)
                .map(|army| {
                    format!(
                        "{}:{}/{}:s{}b{}p{}",
                        army.id,
                        army.morale_loss,
                        army.morale_threshold,
                        army.shaken as i32,
                        army.broken as i32,
                        army.pips
                    )
                })
        })
        .collect::<Vec<_>>();
    lines.push(format!(
        "M {}",
        if morale_tokens.is_empty() {
            "-".to_string()
        } else {
            morale_tokens.join(";")
        }
    ));
    lines.push(build_short_command_state(state));
    lines.push(build_short_formation_state(state));
    let mut deployment_zones = state.deployment_zones.clone();
    deployment_zones.sort_by(|left, right| {
        (left.army.to_string(), left.min_y, left.min_x).cmp(&(
            right.army.to_string(),
            right.min_y,
            right.min_x,
        ))
    });
    let zone_tokens = deployment_zones
        .into_iter()
        .map(|zone| {
            format!(
                "{}:x{}-{}y{}-{}",
                zone.army, zone.min_x, zone.max_x, zone.min_y, zone.max_y
            )
        })
        .collect::<Vec<_>>();
    lines.push(format!(
        "Z {}",
        if zone_tokens.is_empty() {
            "-".to_string()
        } else {
            zone_tokens.join(";")
        }
    ));
    let mut terrain_tiles = state.terrain.clone();
    terrain_tiles.sort_by(|left, right| {
        (left.position.y, left.position.x, left.terrain.to_string()).cmp(&(
            right.position.y,
            right.position.x,
            right.terrain.to_string(),
        ))
    });
    let terrain_tokens = terrain_tiles
        .into_iter()
        .map(|tile| format!("{}={}", coord_token(&tile.position), tile.terrain))
        .collect::<Vec<_>>();
    lines.push(format!(
        "T {}",
        if terrain_tokens.is_empty() {
            "-".to_string()
        } else {
            terrain_tokens.join(";")
        }
    ));
    let mut units = state.units.clone();
    units.sort_by(|left, right| {
        (left.army.to_string(), left.id.clone()).cmp(&(right.army.to_string(), right.id.clone()))
    });
    for unit in &units {
        lines.push(short_unit_line(unit));
    }
    lines.join("\n")
}

pub fn build_short_dynamic_state(state: &crate::types::GameState) -> String {
    let mut lines = vec![format!(
        "S {} {} b{} {} pip{}/{} {}x{} win{} ready{}",
        state.scenario_id,
        state.phase,
        state.bound_number,
        state.current_player,
        state.pips_remaining,
        state.last_pip_roll,
        state.board_width,
        state.board_height,
        state
            .winner
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "-".to_string()),
        if state.deployment_ready.is_empty() {
            "-".to_string()
        } else {
            state
                .deployment_ready
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join(",")
        }
    )];
    let morale_tokens = [ArmyId::A, ArmyId::B]
        .iter()
        .filter_map(|army_id| {
            state
                .armies
                .iter()
                .find(|army| &army.id == army_id)
                .map(|army| {
                    format!(
                        "{}:{}/{}{}{}p{}",
                        army.id,
                        army.morale_loss,
                        army.morale_threshold,
                        if army.shaken { "s" } else { "" },
                        if army.broken { "b" } else { "" },
                        army.pips
                    )
                })
        })
        .collect::<Vec<_>>();
    lines.push(format!(
        "M {}",
        if morale_tokens.is_empty() {
            "-".to_string()
        } else {
            morale_tokens.join(";")
        }
    ));
    lines.push(build_short_command_state(state));
    lines.push(build_short_formation_state(state));
    if state.phase == GamePhase::Deployment {
        let mut deployment_zones = state.deployment_zones.clone();
        deployment_zones.sort_by(|left, right| {
            (left.army.to_string(), left.min_y, left.min_x).cmp(&(
                right.army.to_string(),
                right.min_y,
                right.min_x,
            ))
        });
        let zone_tokens = deployment_zones
            .into_iter()
            .map(|zone| {
                format!(
                    "{}:x{}-{}y{}-{}",
                    zone.army, zone.min_x, zone.max_x, zone.min_y, zone.max_y
                )
            })
            .collect::<Vec<_>>();
        lines.push(format!(
            "Z {}",
            if zone_tokens.is_empty() {
                "-".to_string()
            } else {
                zone_tokens.join(";")
            }
        ));
    }
    let mut terrain_tiles = state.terrain.clone();
    terrain_tiles.sort_by(|left, right| {
        (left.position.y, left.position.x, left.terrain.to_string()).cmp(&(
            right.position.y,
            right.position.x,
            right.terrain.to_string(),
        ))
    });
    let terrain_tokens = terrain_tiles
        .into_iter()
        .map(|tile| {
            format!(
                "{}={}",
                coord_token(&tile.position),
                terrain_token(&tile.terrain)
            )
        })
        .collect::<Vec<_>>();
    lines.push(format!(
        "T {}",
        if terrain_tokens.is_empty() {
            "-".to_string()
        } else {
            terrain_tokens.join(";")
        }
    ));
    let mut units = state.units.clone();
    units.sort_by(|left, right| {
        (left.army.to_string(), left.id.clone()).cmp(&(right.army.to_string(), right.id.clone()))
    });
    for unit in &units {
        lines.push(short_dynamic_unit_line(unit));
    }
    lines.join("\n")
}

pub fn build_short_dynamic_state_perspective(
    state: &crate::types::GameState,
    viewer: &ArmyId,
) -> String {
    let mut lines = vec![format!(
        "S {} {} b{} SELF pip{}/{} {}x{} win{} ready{} dep{} first{}",
        state.scenario_id,
        state.phase,
        state.bound_number,
        state.pips_remaining,
        state.last_pip_roll,
        state.board_width,
        state.board_height,
        state
            .winner
            .as_ref()
            .map(|army| perspective_army_token(viewer, army).to_string())
            .unwrap_or_else(|| "-".to_string()),
        if state.deployment_ready.is_empty() {
            "-".to_string()
        } else {
            state
                .deployment_ready
                .iter()
                .map(|army| perspective_army_token(viewer, army).to_string())
                .collect::<Vec<_>>()
                .join(",")
        },
        perspective_army_token(viewer, &state.deployment_first_army),
        perspective_army_token(viewer, &state.first_bound_army)
    )];
    let morale_tokens = [viewer.clone(), viewer.other()]
        .iter()
        .filter_map(|army_id| {
            state
                .armies
                .iter()
                .find(|army| &army.id == army_id)
                .map(|army| {
                    format!(
                        "{}:{}/{}{}{}p{}",
                        perspective_army_token(viewer, &army.id),
                        army.morale_loss,
                        army.morale_threshold,
                        if army.shaken { "s" } else { "" },
                        if army.broken { "b" } else { "" },
                        army.pips
                    )
                })
        })
        .collect::<Vec<_>>();
    lines.push(format!(
        "M {}",
        if morale_tokens.is_empty() {
            "-".to_string()
        } else {
            morale_tokens.join(";")
        }
    ));
    lines.push(build_short_command_state_perspective(state, viewer));
    lines.push(build_short_formation_state_perspective(state, viewer));
    if state.phase == GamePhase::Deployment {
        let mut deployment_zones = state.deployment_zones.clone();
        deployment_zones.sort_by(|left, right| {
            let left_bounds = perspective_zone_bounds(state, viewer, left);
            let right_bounds = perspective_zone_bounds(state, viewer, right);
            (
                perspective_army_order(viewer, &left.army),
                left_bounds.2,
                left_bounds.0,
            )
                .cmp(&(
                    perspective_army_order(viewer, &right.army),
                    right_bounds.2,
                    right_bounds.0,
                ))
        });
        let zone_tokens = deployment_zones
            .into_iter()
            .filter(|zone| zone.army == *viewer)
            .map(|zone| {
                let (min_x, max_x, min_y, max_y) = perspective_zone_bounds(state, viewer, &zone);
                format!(
                    "{}:x{}-{}y{}-{}",
                    perspective_army_token(viewer, &zone.army),
                    min_x,
                    max_x,
                    min_y,
                    max_y
                )
            })
            .collect::<Vec<_>>();
        lines.push(format!(
            "Z {}",
            if zone_tokens.is_empty() {
                "-".to_string()
            } else {
                zone_tokens.join(";")
            }
        ));
    }
    let mut terrain_tiles = state.terrain.clone();
    terrain_tiles.sort_by(|left, right| {
        let left_coord = perspective_coord(state, viewer, &left.position);
        let right_coord = perspective_coord(state, viewer, &right.position);
        (left_coord.y, left_coord.x, left.terrain.to_string()).cmp(&(
            right_coord.y,
            right_coord.x,
            right.terrain.to_string(),
        ))
    });
    let terrain_tokens = terrain_tiles
        .into_iter()
        .map(|tile| {
            format!(
                "{}={}",
                perspective_coord_token(state, viewer, &tile.position),
                terrain_token(&tile.terrain)
            )
        })
        .collect::<Vec<_>>();
    lines.push(format!(
        "T {}",
        if terrain_tokens.is_empty() {
            "-".to_string()
        } else {
            terrain_tokens.join(";")
        }
    ));
    let mut units = state
        .units
        .iter()
        .filter(|unit| {
            !(state.phase == GamePhase::Deployment && unit.army != *viewer && !unit.deployed)
        })
        .cloned()
        .collect::<Vec<_>>();
    units.sort_by(|left, right| {
        (
            perspective_army_order(viewer, &left.army),
            perspective_unit_id(viewer, &left.id),
        )
            .cmp(&(
                perspective_army_order(viewer, &right.army),
                perspective_unit_id(viewer, &right.id),
            ))
    });
    for unit in &units {
        lines.push(short_dynamic_unit_line_perspective(state, viewer, unit));
    }
    lines.join("\n")
}

pub(crate) fn build_short_command_state(state: &crate::types::GameState) -> String {
    let tokens = [ArmyId::A, ArmyId::B]
        .iter()
        .map(|army_id| {
            let mut leaders = state
                .units
                .iter()
                .filter(|unit| {
                    &unit.army == army_id && unit.leader && !unit.eliminated && !unit.off_map
                })
                .collect::<Vec<_>>();
            leaders.sort_by(|left, right| left.id.cmp(&right.id));
            let leader_token = leaders
                .first()
                .map(|leader| format!("{}@{}", leader.id, coord_token(&leader.position)))
                .unwrap_or_else(|| "-".to_string());
            format!(
                "{}:r{}:ldr={}",
                army_id,
                command_radius_for_army(state, army_id),
                leader_token
            )
        })
        .collect::<Vec<_>>();
    format!("C {}", tokens.join(";"))
}

pub(crate) fn build_short_command_state_perspective(
    state: &crate::types::GameState,
    viewer: &ArmyId,
) -> String {
    let tokens = [viewer.clone(), viewer.other()]
        .iter()
        .map(|army_id| {
            let mut leaders = state
                .units
                .iter()
                .filter(|unit| {
                    &unit.army == army_id && unit.leader && !unit.eliminated && !unit.off_map
                })
                .collect::<Vec<_>>();
            leaders.sort_by(|left, right| left.id.cmp(&right.id));
            let leader_token = leaders
                .first()
                .map(|leader| {
                    format!(
                        "{}@{}",
                        perspective_unit_id(viewer, &leader.id),
                        perspective_coord_token(state, viewer, &leader.position)
                    )
                })
                .unwrap_or_else(|| "-".to_string());
            format!(
                "{}:r{}:ldr={}",
                perspective_army_token(viewer, army_id),
                command_radius_for_army(state, army_id),
                leader_token
            )
        })
        .collect::<Vec<_>>();
    format!("C {}", tokens.join(";"))
}

pub(crate) fn build_short_formation_state(state: &crate::types::GameState) -> String {
    let mut tokens = Vec::new();
    for army_id in [ArmyId::A, ArmyId::B] {
        let units = state
            .units
            .iter()
            .filter(|unit| unit.army == army_id && !unit.eliminated && !unit.off_map)
            .collect::<Vec<_>>();
        let in_command = units.iter().filter(|unit| unit.in_command).count();
        let ordered_pikes = units
            .iter()
            .filter(|unit| unit.formation_state == FormationState::OrderedPike)
            .count();
        let disordered_pikes = units
            .iter()
            .filter(|unit| unit.formation_state == FormationState::DisorderedPike)
            .count();
        let disordered = units.iter().filter(|unit| unit.disordered).count();
        let panic = units
            .iter()
            .filter(|unit| unit.formation_state == FormationState::Panic)
            .count();
        let overpursuit = units
            .iter()
            .filter(|unit| unit.formation_state == FormationState::Overpursuit)
            .count();
        tokens.push(format!(
            "{}:cmd={}/{}:OP={}:DP={}:D={}:P={}:O={}",
            army_id,
            in_command,
            units.len(),
            ordered_pikes,
            disordered_pikes,
            disordered,
            panic,
            overpursuit
        ));
    }
    format!("F {}", tokens.join(";"))
}

pub(crate) fn build_short_formation_state_perspective(
    state: &crate::types::GameState,
    viewer: &ArmyId,
) -> String {
    let mut tokens = Vec::new();
    for army_id in [viewer.clone(), viewer.other()] {
        let units = state
            .units
            .iter()
            .filter(|unit| unit.army == army_id && !unit.eliminated && !unit.off_map)
            .collect::<Vec<_>>();
        let in_command = units.iter().filter(|unit| unit.in_command).count();
        let ordered_pikes = units
            .iter()
            .filter(|unit| unit.formation_state == FormationState::OrderedPike)
            .count();
        let disordered_pikes = units
            .iter()
            .filter(|unit| unit.formation_state == FormationState::DisorderedPike)
            .count();
        let disordered = units.iter().filter(|unit| unit.disordered).count();
        let panic = units
            .iter()
            .filter(|unit| unit.formation_state == FormationState::Panic)
            .count();
        let overpursuit = units
            .iter()
            .filter(|unit| unit.formation_state == FormationState::Overpursuit)
            .count();
        tokens.push(format!(
            "{}:cmd={}/{}:OP={}:DP={}:D={}:P={}:O={}",
            perspective_army_token(viewer, &army_id),
            in_command,
            units.len(),
            ordered_pikes,
            disordered_pikes,
            disordered,
            panic,
            overpursuit
        ));
    }
    format!("F {}", tokens.join(";"))
}

pub(crate) fn short_unit_line(unit: &Unit) -> String {
    let quality_token = match unit.quality.to_string().as_str() {
        "inferior" => "i",
        "ordinary" => "o",
        "superior" => "s",
        _ => "?",
    };
    format!(
        "U {} {} {} {},{} L{} Q{} C{} D{} A{} CH{} X{} UC={} FS={} PC={} MV={} DEP={} OFF={}",
        unit.id,
        unit.army,
        unit.kind,
        coord_token(&unit.position),
        unit.facing,
        unit.leader as i32,
        quality_token,
        unit.in_command as i32,
        unit.disordered as i32,
        unit.activated_this_bound as i32,
        unit.charging as i32,
        unit.eliminated as i32,
        unit.unit_class,
        unit.formation_state,
        unit.pursuit_class,
        unit.morale_value,
        unit.deployed as i32,
        unit.off_map as i32
    )
}

pub(crate) fn short_dynamic_unit_line(unit: &Unit) -> String {
    let mut flags = Vec::new();
    if unit.leader {
        flags.push("ldr".to_string());
    }
    match unit.quality.to_string().as_str() {
        "inferior" => flags.push("qi".to_string()),
        "superior" => flags.push("qs".to_string()),
        _ => {}
    }
    if !unit.in_command {
        flags.push("ooc".to_string());
    }
    if unit.disordered {
        flags.push("dis".to_string());
    }
    if unit.activated_this_bound {
        flags.push("act".to_string());
    }
    if unit.charging {
        flags.push("chg".to_string());
    }
    if unit.eliminated {
        flags.push("elim".to_string());
    }
    if unit.off_map {
        flags.push("off".to_string());
    }
    if !unit.deployed {
        flags.push("res".to_string());
    }
    if unit.formation_state == FormationState::OrderedPike {
        flags.push("op".to_string());
    } else if unit.formation_state != FormationState::Normal {
        flags.push(format!(
            "fs={}",
            short_formation_state_token(&unit.formation_state)
        ));
    }
    format!(
        "U {} {} {}{} {}",
        unit.id,
        unit_profile(&unit.kind).short_name,
        coord_token(&unit.position),
        unit.facing,
        if flags.is_empty() {
            "-".to_string()
        } else {
            flags.join(",")
        }
    )
}

pub(crate) fn short_dynamic_unit_line_perspective(
    state: &crate::types::GameState,
    viewer: &ArmyId,
    unit: &Unit,
) -> String {
    let mut flags = Vec::new();
    if unit.leader {
        flags.push("ldr".to_string());
    }
    match unit.quality.to_string().as_str() {
        "inferior" => flags.push("qi".to_string()),
        "superior" => flags.push("qs".to_string()),
        _ => {}
    }
    if !unit.in_command {
        flags.push("ooc".to_string());
    }
    if unit.disordered {
        flags.push("dis".to_string());
    }
    if unit.activated_this_bound {
        flags.push("act".to_string());
    }
    if unit.charging {
        flags.push("chg".to_string());
    }
    if unit.eliminated {
        flags.push("elim".to_string());
    }
    if unit.off_map {
        flags.push("off".to_string());
    }
    if !unit.deployed {
        flags.push("res".to_string());
    }
    if unit.formation_state == FormationState::OrderedPike {
        flags.push("op".to_string());
    } else if unit.formation_state != FormationState::Normal {
        flags.push(format!(
            "fs={}",
            short_formation_state_token(&unit.formation_state)
        ));
    }
    format!(
        "U {} {} {}{} {}",
        perspective_unit_id(viewer, &unit.id),
        unit_profile(&unit.kind).short_name,
        perspective_coord_token(state, viewer, &unit.position),
        perspective_direction_token(viewer, &unit.facing),
        if flags.is_empty() {
            "-".to_string()
        } else {
            flags.join(",")
        }
    )
}

pub(crate) fn terrain_token(terrain: &crate::types::TerrainType) -> &'static str {
    match terrain {
        crate::types::TerrainType::Open => "O",
        crate::types::TerrainType::Forest => "F",
        crate::types::TerrainType::Hill => "H",
        crate::types::TerrainType::Water => "W",
        crate::types::TerrainType::Road => "R",
    }
}

pub(crate) fn short_formation_state_token(state: &FormationState) -> &'static str {
    match state {
        FormationState::Normal => "n",
        FormationState::OrderedPike => "op",
        FormationState::DisorderedPike => "dp",
        FormationState::Rout => "rout",
        FormationState::Panic => "panic",
        FormationState::Overpursuit => "over",
    }
}

pub fn compact_unit_line(unit: &Unit) -> String {
    let formation_token = if unit.formation_class.to_string() == "open_order" {
        "o"
    } else {
        "c"
    };
    let quality_token = match unit.quality.to_string().as_str() {
        "inferior" => "i",
        "ordinary" => "o",
        "superior" => "s",
        _ => "?",
    };
    format!(
        "U {} {} {} @{} {} L{} F{} Q{} C{} D{} V{} A{} CH{} X{} UC={} FS={} PC={} MV={}",
        unit.id,
        unit.army,
        unit.kind,
        coord_token(&unit.position),
        unit.facing,
        unit.leader as i32,
        formation_token,
        quality_token,
        unit.in_command as i32,
        unit.disordered as i32,
        unit.can_evade as i32,
        unit.activated_this_bound as i32,
        unit.charging as i32,
        unit.eliminated as i32,
        unit.unit_class,
        unit.formation_state,
        unit.pursuit_class,
        unit.morale_value
    )
}

pub(crate) fn perspective_army_token(viewer: &ArmyId, army: &ArmyId) -> &'static str {
    if army == viewer {
        "SELF"
    } else {
        "ENEMY"
    }
}

pub(crate) fn perspective_army_order(viewer: &ArmyId, army: &ArmyId) -> i32 {
    if army == viewer {
        0
    } else {
        1
    }
}

pub(crate) fn perspective_unit_id(viewer: &ArmyId, unit_id: &str) -> String {
    let Some((prefix, suffix)) = unit_id.split_once('-') else {
        return unit_id.to_string();
    };
    let army = match prefix {
        "A" => ArmyId::A,
        "B" => ArmyId::B,
        _ => return unit_id.to_string(),
    };
    format!("{}-{suffix}", perspective_army_token(viewer, &army))
}

pub(crate) fn perspective_coord(
    state: &crate::types::GameState,
    viewer: &ArmyId,
    coord: &Coord,
) -> Coord {
    if *viewer == ArmyId::A {
        return coord.clone();
    }
    Coord {
        x: state.board_width - 1 - coord.x,
        y: state.board_height - 1 - coord.y,
    }
}

pub(crate) fn perspective_coord_token(
    state: &crate::types::GameState,
    viewer: &ArmyId,
    coord: &Coord,
) -> String {
    coord_token(&perspective_coord(state, viewer, coord))
}

pub(crate) fn perspective_direction_token(
    viewer: &ArmyId,
    direction: &crate::types::Direction,
) -> crate::types::Direction {
    if *viewer == ArmyId::A {
        return direction.clone();
    }
    match direction {
        crate::types::Direction::N => crate::types::Direction::S,
        crate::types::Direction::S => crate::types::Direction::N,
        crate::types::Direction::E => crate::types::Direction::W,
        crate::types::Direction::W => crate::types::Direction::E,
    }
}

pub(crate) fn perspective_zone_bounds(
    state: &crate::types::GameState,
    viewer: &ArmyId,
    zone: &crate::types::DeploymentZone,
) -> (i32, i32, i32, i32) {
    let corners = [
        Coord {
            x: zone.min_x,
            y: zone.min_y,
        },
        Coord {
            x: zone.min_x,
            y: zone.max_y,
        },
        Coord {
            x: zone.max_x,
            y: zone.min_y,
        },
        Coord {
            x: zone.max_x,
            y: zone.max_y,
        },
    ]
    .into_iter()
    .map(|coord| perspective_coord(state, viewer, &coord))
    .collect::<Vec<_>>();
    let min_x = corners.iter().map(|coord| coord.x).min().unwrap_or(0);
    let max_x = corners.iter().map(|coord| coord.x).max().unwrap_or(0);
    let min_y = corners.iter().map(|coord| coord.y).min().unwrap_or(0);
    let max_y = corners.iter().map(|coord| coord.y).max().unwrap_or(0);
    (min_x, max_x, min_y, max_y)
}
