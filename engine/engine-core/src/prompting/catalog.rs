use super::*;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ActionCatalogEntry {
    pub index: usize,
    pub summary: String,
    pub action: LegalAction,
}

pub fn build_action_catalog(legal_actions: &[LegalAction]) -> Vec<ActionCatalogEntry> {
    legal_actions
        .iter()
        .enumerate()
        .map(|(index, action)| ActionCatalogEntry {
            index,
            summary: describe_legal_action(action),
            action: action.clone(),
        })
        .collect()
}

#[derive(Serialize)]
pub(crate) struct StrictActionCatalogEntry<'a> {
    pub index: usize,
    pub summary: String,
    pub action: StrictCatalogLegalAction<'a>,
}

impl<'a> From<&'a ActionCatalogEntry> for StrictActionCatalogEntry<'a> {
    fn from(entry: &'a ActionCatalogEntry) -> Self {
        Self {
            index: entry.index,
            summary: strict_catalog_summary(&entry.summary),
            action: StrictCatalogLegalAction::from(&entry.action),
        }
    }
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum StrictCatalogLegalAction<'a> {
    Deploy {
        unit_id: &'a str,
        destination: &'a Coord,
    },
    Move {
        unit_id: &'a str,
        destination: &'a Coord,
        path: &'a [Coord],
        facing: &'a crate::types::Direction,
        pip_cost: i32,
    },
    MarchMove {
        unit_id: &'a str,
        destination: &'a Coord,
        path: &'a [Coord],
        facing: &'a crate::types::Direction,
        pip_cost: i32,
    },
    Charge {
        unit_id: &'a str,
        target_id: &'a str,
        destination: &'a Coord,
        path: &'a [Coord],
        facing: &'a crate::types::Direction,
        aspect: &'a str,
        pip_cost: i32,
    },
    GroupMove {
        unit_ids: &'a [String],
        steps: &'a [GroupMoveStep],
        pip_cost: i32,
    },
    GroupMarchMove {
        unit_ids: &'a [String],
        steps: &'a [GroupMoveStep],
        pip_cost: i32,
    },
    GroupCharge {
        unit_ids: &'a [String],
        steps: &'a [GroupChargeStep],
        pip_cost: i32,
    },
    Rotate {
        unit_id: &'a str,
        facing: &'a crate::types::Direction,
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

impl<'a> From<&'a LegalAction> for StrictCatalogLegalAction<'a> {
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
                ..
            } => Self::Charge {
                unit_id,
                target_id,
                destination,
                path,
                facing,
                aspect,
                pip_cost: *pip_cost,
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
                ..
            } => Self::GroupCharge {
                unit_ids,
                steps,
                pip_cost: *pip_cost,
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

pub(crate) fn action_catalog_json_for_prompt(
    action_catalog: &[ActionCatalogEntry],
    strict: bool,
) -> String {
    if !strict {
        return serde_json::to_string(action_catalog).expect("action catalog should serialize");
    }
    let strict_catalog: Vec<StrictActionCatalogEntry<'_>> = action_catalog
        .iter()
        .map(StrictActionCatalogEntry::from)
        .collect();
    serde_json::to_string(&strict_catalog).expect("action catalog should serialize")
}

pub(crate) fn strict_catalog_summary(summary: &str) -> String {
    summary
        .split_once(" warning=")
        .map(|(before, _)| before)
        .unwrap_or(summary)
        .to_string()
}

pub fn build_legal_action_lines(
    state: &crate::types::GameState,
    legal_actions: &[LegalAction],
) -> String {
    if legal_actions.is_empty() {
        return "A -".to_string();
    }
    let shown_indices = shown_legal_action_indices(state, legal_actions);
    let mut lines = vec![build_action_count_line_for_shown(
        legal_actions,
        shown_indices.len(),
    )];
    if shown_indices.len() < legal_actions.len() {
        lines.push("SHOW original_indices subset=1 choose_shown_index_only".to_string());
    }
    lines.extend(build_short_legal_action_lines(
        state,
        legal_actions,
        &shown_indices,
    ));
    lines.join("\n")
}

pub fn build_legal_action_lines_perspective(
    state: &crate::types::GameState,
    viewer: &ArmyId,
    legal_actions: &[LegalAction],
) -> String {
    if legal_actions.is_empty() {
        return "A -".to_string();
    }
    let shown_indices = shown_legal_action_indices(state, legal_actions);
    let mut lines = vec![build_action_count_line_for_shown(
        legal_actions,
        shown_indices.len(),
    )];
    if shown_indices.len() < legal_actions.len() {
        lines.push("SHOW original_indices subset=1 choose_shown_index_only".to_string());
    }
    lines.extend(build_short_legal_action_lines_perspective(
        state,
        viewer,
        legal_actions,
        &shown_indices,
    ));
    lines.join("\n")
}

pub(crate) fn build_action_count_line_for_shown(
    legal_actions: &[LegalAction],
    shown_count: usize,
) -> String {
    let mut counts = std::collections::BTreeMap::new();
    for action in legal_actions {
        *counts
            .entry(short_action_type_token(action))
            .or_insert(0usize) += 1;
    }
    format!(
        "N shown={}/{} {}",
        shown_count,
        legal_actions.len(),
        counts
            .into_iter()
            .map(|(kind, count)| format!("{kind}={count}"))
            .collect::<Vec<_>>()
            .join(" ")
    )
}

pub(crate) const STRICT_ACTION_LIST_FULL_LIMIT: usize = 80;
pub(crate) const STRICT_GROUP_MOVE_LIMIT: usize = 24;
pub(crate) const STRICT_GROUP_MARCH_LIMIT: usize = 12;
pub(crate) const STRICT_SINGLE_MOVE_LIMIT: usize = 18;
pub(crate) const STRICT_SINGLE_MARCH_LIMIT: usize = 8;

pub(crate) fn shown_legal_action_indices(
    state: &crate::types::GameState,
    legal_actions: &[LegalAction],
) -> Vec<usize> {
    if legal_actions.len() <= STRICT_ACTION_LIST_FULL_LIMIT {
        return (0..legal_actions.len()).collect();
    }

    let mut shown = std::collections::BTreeSet::new();
    let mut group_moves = Vec::new();
    let mut group_marches = Vec::new();
    let mut single_moves = Vec::new();
    let mut single_marches = Vec::new();

    for (index, action) in legal_actions.iter().enumerate() {
        match action {
            LegalAction::Move { .. } => {
                single_moves.push((movement_action_score(state, action), index))
            }
            LegalAction::MarchMove { .. } => {
                single_marches.push((movement_action_score(state, action), index));
            }
            LegalAction::GroupMove { .. } => {
                group_moves.push((movement_action_score(state, action), index));
            }
            LegalAction::GroupMarchMove { .. } => {
                group_marches.push((movement_action_score(state, action), index));
            }
            // Rotations are cheap once grouped, and they are sometimes the only sane setup move.
            LegalAction::Rotate { .. } => {
                shown.insert(index);
            }
            _ => {
                shown.insert(index);
            }
        }
    }

    insert_top_scored_indices(&mut shown, group_moves, STRICT_GROUP_MOVE_LIMIT);
    insert_top_scored_indices(&mut shown, group_marches, STRICT_GROUP_MARCH_LIMIT);
    insert_top_scored_indices(&mut shown, single_moves, STRICT_SINGLE_MOVE_LIMIT);
    insert_top_scored_indices(&mut shown, single_marches, STRICT_SINGLE_MARCH_LIMIT);
    shown.into_iter().collect()
}

pub(crate) fn insert_top_scored_indices(
    shown: &mut std::collections::BTreeSet<usize>,
    mut scored: Vec<(i32, usize)>,
    limit: usize,
) {
    scored.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| left.1.cmp(&right.1)));
    for (_, index) in scored.into_iter().take(limit) {
        shown.insert(index);
    }
}

pub(crate) fn movement_action_score(state: &crate::types::GameState, action: &LegalAction) -> i32 {
    match action {
        LegalAction::Move {
            unit_id,
            destination,
            pip_cost,
            ..
        }
        | LegalAction::MarchMove {
            unit_id,
            destination,
            pip_cost,
            ..
        } => find_unit(state, unit_id)
            .map(|unit| {
                movement_progress_score(&unit.army, &unit.position, destination) * 100
                    - pip_cost * 20
            })
            .unwrap_or(-10_000),
        LegalAction::GroupMove {
            steps, pip_cost, ..
        }
        | LegalAction::GroupMarchMove {
            steps, pip_cost, ..
        } => {
            if steps.is_empty() {
                return -10_000;
            }
            let progress_total = steps
                .iter()
                .filter_map(|step| {
                    find_unit(state, &step.unit_id).map(|unit| {
                        movement_progress_score(&unit.army, &unit.position, &step.destination)
                    })
                })
                .sum::<i32>();
            let average_progress = progress_total * 100 / steps.len() as i32;
            average_progress + steps.len() as i32 * 35 - pip_cost * 20
        }
        _ => 0,
    }
}

pub(crate) fn movement_progress_score(army: &ArmyId, from: &Coord, to: &Coord) -> i32 {
    match army {
        ArmyId::A => from.y - to.y,
        ArmyId::B => to.y - from.y,
    }
}

pub(crate) fn build_short_legal_action_lines(
    state: &crate::types::GameState,
    legal_actions: &[LegalAction],
    shown_indices: &[usize],
) -> Vec<String> {
    let shown = shown_indices
        .iter()
        .copied()
        .collect::<std::collections::BTreeSet<_>>();
    let mut lines = Vec::new();
    let mut moves: std::collections::BTreeMap<(String, i32), Vec<String>> =
        std::collections::BTreeMap::new();
    let mut marches: std::collections::BTreeMap<(String, i32), Vec<String>> =
        std::collections::BTreeMap::new();
    let mut rotations: std::collections::BTreeMap<(String, i32), Vec<String>> =
        std::collections::BTreeMap::new();

    for (index, action) in legal_actions.iter().enumerate() {
        if !shown.contains(&index) {
            continue;
        }
        match action {
            LegalAction::Move {
                unit_id,
                destination,
                facing,
                pip_cost,
                ..
            } => moves
                .entry((unit_id.clone(), *pip_cost))
                .or_default()
                .push(format!("{index}:{}{}", coord_token(destination), facing)),
            LegalAction::MarchMove {
                unit_id,
                destination,
                facing,
                pip_cost,
                ..
            } => marches
                .entry((unit_id.clone(), *pip_cost))
                .or_default()
                .push(format!("{index}:{}{}", coord_token(destination), facing)),
            LegalAction::Rotate {
                unit_id,
                facing,
                pip_cost,
            } => rotations
                .entry((unit_id.clone(), *pip_cost))
                .or_default()
                .push(format!("{index}:{facing}")),
            LegalAction::GroupMove {
                steps, pip_cost, ..
            } => lines.push(format!(
                "G {index} c{} [{}]",
                pip_cost,
                short_group_move_steps(steps)
            )),
            LegalAction::GroupMarchMove {
                steps, pip_cost, ..
            } => lines.push(format!(
                "GM {index} c{} [{}]",
                pip_cost,
                short_group_move_steps(steps)
            )),
            LegalAction::GroupCharge {
                steps, pip_cost, ..
            } => lines.push(format!(
                "GC {index} c{} [{}]",
                pip_cost,
                short_group_charge_steps(steps)
            )),
            LegalAction::Charge {
                unit_id,
                target_id,
                destination,
                facing,
                aspect,
                pip_cost,
                ..
            } => lines.push(format!(
                "CH {index} c{} {}>{}@{}{} {} e={}",
                pip_cost,
                unit_id,
                target_id,
                coord_token(destination),
                facing,
                aspect,
                short_charge_effect_token(state, action)
            )),
            LegalAction::Shoot {
                unit_id,
                target_id,
                range,
                pip_cost,
            } => lines.push(format!(
                "SH {index} c{} {}>{} r{}",
                pip_cost, unit_id, target_id, range
            )),
            LegalAction::Rally { unit_id, pip_cost } => {
                lines.push(format!("RA {index} c{} {}", pip_cost, unit_id));
            }
            LegalAction::ReformPike { unit_id, pip_cost } => {
                lines.push(format!("RP {index} c{} {}", pip_cost, unit_id));
            }
            LegalAction::Deploy {
                unit_id,
                destination,
            } => lines.push(format!(
                "D {index} {}>{}",
                unit_id,
                coord_token(destination)
            )),
            LegalAction::FinalizeDeployment => lines.push(format!("FIN {index}")),
            LegalAction::EndBound => lines.push(format!("END {index}")),
        }
    }

    lines.extend(render_option_groups("M", moves));
    lines.extend(render_option_groups("MM", marches));
    lines.extend(render_option_groups("R", rotations));
    lines
}

pub(crate) fn build_short_legal_action_lines_perspective(
    state: &crate::types::GameState,
    viewer: &ArmyId,
    legal_actions: &[LegalAction],
    shown_indices: &[usize],
) -> Vec<String> {
    let shown = shown_indices
        .iter()
        .copied()
        .collect::<std::collections::BTreeSet<_>>();
    let mut lines = Vec::new();
    let mut moves: std::collections::BTreeMap<(String, i32), Vec<String>> =
        std::collections::BTreeMap::new();
    let mut marches: std::collections::BTreeMap<(String, i32), Vec<String>> =
        std::collections::BTreeMap::new();
    let mut rotations: std::collections::BTreeMap<(String, i32), Vec<String>> =
        std::collections::BTreeMap::new();

    for (index, action) in legal_actions.iter().enumerate() {
        if !shown.contains(&index) {
            continue;
        }
        match action {
            LegalAction::Move {
                unit_id,
                destination,
                facing,
                pip_cost,
                ..
            } => moves
                .entry((perspective_unit_id(viewer, unit_id), *pip_cost))
                .or_default()
                .push(format!(
                    "{index}:{}{}",
                    perspective_coord_token(state, viewer, destination),
                    perspective_direction_token(viewer, facing)
                )),
            LegalAction::MarchMove {
                unit_id,
                destination,
                facing,
                pip_cost,
                ..
            } => marches
                .entry((perspective_unit_id(viewer, unit_id), *pip_cost))
                .or_default()
                .push(format!(
                    "{index}:{}{}",
                    perspective_coord_token(state, viewer, destination),
                    perspective_direction_token(viewer, facing)
                )),
            LegalAction::Rotate {
                unit_id,
                facing,
                pip_cost,
            } => rotations
                .entry((perspective_unit_id(viewer, unit_id), *pip_cost))
                .or_default()
                .push(format!(
                    "{index}:{}",
                    perspective_direction_token(viewer, facing)
                )),
            LegalAction::GroupMove {
                steps, pip_cost, ..
            } => lines.push(format!(
                "G {index} c{} [{}]",
                pip_cost,
                short_group_move_steps_perspective(state, viewer, steps)
            )),
            LegalAction::GroupMarchMove {
                steps, pip_cost, ..
            } => lines.push(format!(
                "GM {index} c{} [{}]",
                pip_cost,
                short_group_move_steps_perspective(state, viewer, steps)
            )),
            LegalAction::GroupCharge {
                steps, pip_cost, ..
            } => lines.push(format!(
                "GC {index} c{} [{}]",
                pip_cost,
                short_group_charge_steps_perspective(state, viewer, steps)
            )),
            LegalAction::Charge {
                unit_id,
                target_id,
                destination,
                facing,
                aspect,
                pip_cost,
                ..
            } => lines.push(format!(
                "CH {index} c{} {}>{}@{}{} {} e={}",
                pip_cost,
                perspective_unit_id(viewer, unit_id),
                perspective_unit_id(viewer, target_id),
                perspective_coord_token(state, viewer, destination),
                perspective_direction_token(viewer, facing),
                aspect,
                short_charge_effect_token(state, action)
            )),
            LegalAction::Shoot {
                unit_id,
                target_id,
                range,
                pip_cost,
            } => lines.push(format!(
                "SH {index} c{} {}>{} r{}",
                pip_cost,
                perspective_unit_id(viewer, unit_id),
                perspective_unit_id(viewer, target_id),
                range
            )),
            LegalAction::Rally { unit_id, pip_cost } => {
                lines.push(format!(
                    "RA {index} c{} {}",
                    pip_cost,
                    perspective_unit_id(viewer, unit_id)
                ));
            }
            LegalAction::ReformPike { unit_id, pip_cost } => {
                lines.push(format!(
                    "RP {index} c{} {}",
                    pip_cost,
                    perspective_unit_id(viewer, unit_id)
                ));
            }
            LegalAction::Deploy {
                unit_id,
                destination,
            } => lines.push(format!(
                "D {index} {}>{}",
                perspective_unit_id(viewer, unit_id),
                perspective_coord_token(state, viewer, destination)
            )),
            LegalAction::FinalizeDeployment => lines.push(format!("FIN {index}")),
            LegalAction::EndBound => lines.push(format!("END {index}")),
        }
    }

    lines.extend(render_option_groups("M", moves));
    lines.extend(render_option_groups("MM", marches));
    lines.extend(render_option_groups("R", rotations));
    lines
}

pub(crate) fn render_option_groups(
    prefix: &str,
    groups: std::collections::BTreeMap<(String, i32), Vec<String>>,
) -> Vec<String> {
    groups
        .into_iter()
        .map(|((unit_id, pip_cost), options)| {
            format!("{prefix} {unit_id} c{} {}", pip_cost, options.join(" "))
        })
        .collect()
}

pub(crate) fn short_group_move_steps(steps: &[crate::types::GroupMoveStep]) -> String {
    let mut shown = steps
        .iter()
        .take(6)
        .map(|step| {
            format!(
                "{}>{}{}",
                step.unit_id,
                coord_token(&step.destination),
                step.facing
            )
        })
        .collect::<Vec<_>>();
    if steps.len() > 6 {
        shown.push(format!("+{}", steps.len() - 6));
    }
    shown.join(";")
}

pub(crate) fn short_group_move_steps_perspective(
    state: &crate::types::GameState,
    viewer: &ArmyId,
    steps: &[crate::types::GroupMoveStep],
) -> String {
    let mut shown = steps
        .iter()
        .take(6)
        .map(|step| {
            format!(
                "{}>{}{}",
                perspective_unit_id(viewer, &step.unit_id),
                perspective_coord_token(state, viewer, &step.destination),
                perspective_direction_token(viewer, &step.facing)
            )
        })
        .collect::<Vec<_>>();
    if steps.len() > 6 {
        shown.push(format!("+{}", steps.len() - 6));
    }
    shown.join(";")
}

pub(crate) fn short_group_charge_steps(steps: &[crate::types::GroupChargeStep]) -> String {
    let mut shown = steps
        .iter()
        .take(6)
        .map(|step| {
            format!(
                "{}>{}@{}{}",
                step.unit_id,
                step.target_id,
                coord_token(&step.destination),
                step.facing
            )
        })
        .collect::<Vec<_>>();
    if steps.len() > 6 {
        shown.push(format!("+{}", steps.len() - 6));
    }
    shown.join(";")
}

pub(crate) fn short_group_charge_steps_perspective(
    state: &crate::types::GameState,
    viewer: &ArmyId,
    steps: &[crate::types::GroupChargeStep],
) -> String {
    let mut shown = steps
        .iter()
        .take(6)
        .map(|step| {
            format!(
                "{}>{}@{}{}",
                perspective_unit_id(viewer, &step.unit_id),
                perspective_unit_id(viewer, &step.target_id),
                perspective_coord_token(state, viewer, &step.destination),
                perspective_direction_token(viewer, &step.facing)
            )
        })
        .collect::<Vec<_>>();
    if steps.len() > 6 {
        shown.push(format!("+{}", steps.len() - 6));
    }
    shown.join(";")
}

pub(crate) fn short_charge_effect_token(
    state: &crate::types::GameState,
    action: &LegalAction,
) -> &'static str {
    match short_immediate_effect(state, action) {
        "move_now+evade" => "evade",
        "move_now+contact" => "contact",
        "move_now+breakoff" => "breakoff",
        other => other,
    }
}

pub(crate) fn short_action_type_token(action: &LegalAction) -> &'static str {
    match action {
        LegalAction::Deploy { .. } => "D",
        LegalAction::Move { .. } => "M",
        LegalAction::MarchMove { .. } => "MM",
        LegalAction::Charge { .. } => "CH",
        LegalAction::GroupMove { .. } => "G",
        LegalAction::GroupMarchMove { .. } => "GM",
        LegalAction::GroupCharge { .. } => "GC",
        LegalAction::Rotate { .. } => "R",
        LegalAction::Shoot { .. } => "SH",
        LegalAction::Rally { .. } => "RA",
        LegalAction::ReformPike { .. } => "RP",
        LegalAction::FinalizeDeployment => "FIN",
        LegalAction::EndBound => "END",
    }
}

pub fn build_deployment_option_lines(
    state: &crate::types::GameState,
    legal_actions: &[LegalAction],
) -> String {
    let deploy_actions = legal_actions
        .iter()
        .filter_map(|action| match action {
            LegalAction::Deploy {
                unit_id,
                destination,
            } => Some((unit_id, destination)),
            _ => None,
        })
        .collect::<Vec<_>>();
    if deploy_actions.is_empty() {
        if legal_actions
            .iter()
            .any(|action| matches!(action, LegalAction::FinalizeDeployment))
        {
            return "DOPT finalize_deployment".to_string();
        }
        return "DOPT -".to_string();
    }

    let mut options_by_unit: std::collections::BTreeMap<String, Vec<Coord>> =
        std::collections::BTreeMap::new();
    for (unit_id, destination) in deploy_actions {
        options_by_unit
            .entry(unit_id.clone())
            .or_default()
            .push(destination.clone());
    }

    let mut grouped_by_options: std::collections::BTreeMap<String, Vec<String>> =
        std::collections::BTreeMap::new();
    for (unit_id, mut options) in options_by_unit {
        options.sort_by_key(|coord| (coord.y, coord.x));
        let kind = find_unit(state, &unit_id)
            .map(|unit| unit_profile(&unit.kind).short_name.to_string())
            .unwrap_or_else(|| "?".to_string());
        grouped_by_options
            .entry(coord_set_token(&options))
            .or_default()
            .push(format!("{unit_id}:{kind}"));
    }

    if grouped_by_options.len() == 1 {
        let (cells, mut units) = grouped_by_options.into_iter().next().expect("group exists");
        units.sort();
        return format!("DUNITS {}\nDCELLS {}", units.join(" "), cells);
    }

    grouped_by_options
        .into_iter()
        .map(|(cells, mut units)| {
            units.sort();
            format!("DOPT cells={} units={}", cells, units.join(" "))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn build_deployment_option_lines_perspective(
    state: &crate::types::GameState,
    viewer: &ArmyId,
    legal_actions: &[LegalAction],
) -> String {
    let deploy_actions = legal_actions
        .iter()
        .filter_map(|action| match action {
            LegalAction::Deploy {
                unit_id,
                destination,
            } => Some((unit_id, destination)),
            _ => None,
        })
        .collect::<Vec<_>>();
    if deploy_actions.is_empty() {
        if legal_actions
            .iter()
            .any(|action| matches!(action, LegalAction::FinalizeDeployment))
        {
            return "DOPT finalize_deployment".to_string();
        }
        return "DOPT -".to_string();
    }

    let mut options_by_unit: std::collections::BTreeMap<String, Vec<Coord>> =
        std::collections::BTreeMap::new();
    for (unit_id, destination) in deploy_actions {
        options_by_unit
            .entry(perspective_unit_id(viewer, unit_id))
            .or_default()
            .push(perspective_coord(state, viewer, destination));
    }

    let mut grouped_by_options: std::collections::BTreeMap<String, Vec<String>> =
        std::collections::BTreeMap::new();
    for (unit_id, mut options) in options_by_unit {
        options.sort_by_key(|coord| (coord.y, coord.x));
        let real_unit_id = unit_id
            .strip_prefix("SELF-")
            .map(|suffix| format!("{}-{suffix}", viewer))
            .unwrap_or_else(|| unit_id.clone());
        let kind = find_unit(state, &real_unit_id)
            .map(|unit| unit_profile(&unit.kind).short_name.to_string())
            .unwrap_or_else(|| "?".to_string());
        grouped_by_options
            .entry(coord_set_token(&options))
            .or_default()
            .push(format!("{unit_id}:{kind}"));
    }

    if grouped_by_options.len() == 1 {
        let (cells, mut units) = grouped_by_options.into_iter().next().expect("group exists");
        units.sort();
        return format!("DUNITS {}\nDCELLS {}", units.join(" "), cells);
    }

    grouped_by_options
        .into_iter()
        .map(|(cells, mut units)| {
            units.sort();
            format!("DOPT cells={} units={}", cells, units.join(" "))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn coord_set_token(options: &[Coord]) -> String {
    let mut rows: std::collections::BTreeMap<i32, Vec<i32>> = std::collections::BTreeMap::new();
    for coord in options {
        rows.entry(coord.y).or_default().push(coord.x);
    }
    rows.into_iter()
        .map(|(y, mut xs)| {
            xs.sort();
            xs.dedup();
            format!("{}y{}", compress_int_ranges(&xs), y)
        })
        .collect::<Vec<_>>()
        .join(";")
}

pub(crate) fn compress_int_ranges(values: &[i32]) -> String {
    if values.is_empty() {
        return "-".to_string();
    }
    let mut ranges = Vec::new();
    let mut start = values[0];
    let mut previous = values[0];
    for value in values.iter().skip(1) {
        if *value == previous + 1 {
            previous = *value;
            continue;
        }
        ranges.push(format_int_range(start, previous));
        start = *value;
        previous = *value;
    }
    ranges.push(format_int_range(start, previous));
    ranges.join(",")
}

pub(crate) fn format_int_range(start: i32, end: i32) -> String {
    if start == end {
        format!("x{start}")
    } else {
        format!("x{start}-{end}")
    }
}

pub fn describe_legal_action(action: &LegalAction) -> String {
    match action {
        LegalAction::Deploy {
            unit_id,
            destination,
        } => {
            format!("deploy {unit_id} to ({}, {})", destination.x, destination.y)
        }
        LegalAction::Move {
            unit_id,
            destination,
            path,
            facing,
            ..
        } => format!(
            "move {unit_id} to ({}, {}) facing {} via {}",
            destination.x,
            destination.y,
            facing,
            format_path(path)
        ),
        LegalAction::MarchMove {
            unit_id,
            destination,
            path,
            facing,
            ..
        } => format!(
            "march {unit_id} to ({}, {}) facing {} via {}",
            destination.x,
            destination.y,
            facing,
            format_path(path)
        ),
        LegalAction::Charge {
            unit_id,
            target_id,
            destination,
            path,
            facing,
            aspect,
            ..
        } => format!(
            "charge {unit_id} into {target_id} from ({}, {}) facing {} via {} on {}",
            destination.x,
            destination.y,
            facing,
            format_path(path),
            aspect
        ),
        LegalAction::GroupMove { unit_ids, .. } => format!("group move {}", unit_ids.join(", ")),
        LegalAction::GroupMarchMove { unit_ids, .. } => {
            format!("group march {}", unit_ids.join(", "))
        }
        LegalAction::GroupCharge { unit_ids, .. } => {
            format!("group charge {}", unit_ids.join(", "))
        }
        LegalAction::Rotate {
            unit_id, facing, ..
        } => format!("rotate {unit_id} to {facing}"),
        LegalAction::Shoot {
            unit_id,
            target_id,
            range,
            ..
        } => format!("shoot {unit_id} at {target_id} (range {range})"),
        LegalAction::Rally { unit_id, .. } => format!("rally {unit_id}"),
        LegalAction::ReformPike { unit_id, .. } => format!("reform pike {unit_id}"),
        LegalAction::FinalizeDeployment => "finalize deployment".to_string(),
        LegalAction::EndBound => "end bound".to_string(),
    }
}

pub fn format_path(path: &[Coord]) -> String {
    if path.is_empty() {
        return "[]".to_string();
    }
    path.iter()
        .map(|coord| format!("({}, {})", coord.x, coord.y))
        .collect::<Vec<_>>()
        .join(" -> ")
}

pub fn legal_action_to_action(action: &LegalAction) -> Action {
    match action {
        LegalAction::Deploy {
            unit_id,
            destination,
        } => Action::Deploy {
            unit_id: unit_id.clone(),
            destination: destination.clone(),
        },
        LegalAction::Move {
            unit_id,
            destination,
            path,
            facing,
            ..
        } => Action::Move {
            unit_id: unit_id.clone(),
            destination: destination.clone(),
            path: path.clone(),
            facing: facing.clone(),
        },
        LegalAction::MarchMove {
            unit_id,
            destination,
            path,
            facing,
            ..
        } => Action::MarchMove {
            unit_id: unit_id.clone(),
            destination: destination.clone(),
            path: path.clone(),
            facing: facing.clone(),
        },
        LegalAction::Charge {
            unit_id,
            target_id,
            destination,
            path,
            facing,
            ..
        } => Action::Charge {
            unit_id: unit_id.clone(),
            target_id: target_id.clone(),
            destination: destination.clone(),
            path: path.clone(),
            facing: facing.clone(),
        },
        LegalAction::GroupMove {
            unit_ids, steps, ..
        } => Action::GroupMove {
            unit_ids: unit_ids.clone(),
            steps: steps.clone(),
        },
        LegalAction::GroupMarchMove {
            unit_ids, steps, ..
        } => Action::GroupMarchMove {
            unit_ids: unit_ids.clone(),
            steps: steps.clone(),
        },
        LegalAction::GroupCharge {
            unit_ids, steps, ..
        } => Action::GroupCharge {
            unit_ids: unit_ids.clone(),
            steps: steps.clone(),
        },
        LegalAction::Rotate {
            unit_id, facing, ..
        } => Action::Rotate {
            unit_id: unit_id.clone(),
            facing: facing.clone(),
        },
        LegalAction::Shoot {
            unit_id, target_id, ..
        } => Action::Shoot {
            unit_id: unit_id.clone(),
            target_id: target_id.clone(),
        },
        LegalAction::Rally { unit_id, .. } => Action::Rally {
            unit_id: unit_id.clone(),
        },
        LegalAction::ReformPike { unit_id, .. } => Action::ReformPike {
            unit_id: unit_id.clone(),
        },
        LegalAction::FinalizeDeployment => Action::FinalizeDeployment,
        LegalAction::EndBound => Action::EndBound,
    }
}

pub fn army_sort_key(army: &ArmyId) -> &'static str {
    match army {
        ArmyId::A => "A",
        ArmyId::B => "B",
    }
}
