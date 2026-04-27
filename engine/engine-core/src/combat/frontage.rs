use super::*;

pub(crate) fn build_combat_pairs(state: &GameState) -> Vec<CombatPair> {
    let (frontage_pairs, engaged_units) = build_frontage_pairs(state);
    let mut pairs = frontage_pairs;
    pairs.extend(build_auxiliary_contact_pairs(state, engaged_units));
    pairs
}

pub(crate) fn build_frontage_pairs(state: &GameState) -> (Vec<CombatPair>, HashSet<String>) {
    let mut adjacency: HashMap<String, HashSet<String>> = HashMap::new();
    let units_by_pos: HashMap<(i32, i32), &Unit> = state
        .units
        .iter()
        .filter(|candidate| !candidate.eliminated)
        .map(|candidate| ((candidate.position.x, candidate.position.y), candidate))
        .collect();

    let mut ordered_units: Vec<&Unit> = state
        .units
        .iter()
        .filter(|candidate| !candidate.eliminated)
        .collect();
    ordered_units.sort_by(|left, right| left.id.cmp(&right.id));

    for unit in ordered_units {
        for enemy in adjacent_enemies(state, unit) {
            if enemy.eliminated || enemy.army == unit.army {
                continue;
            }
            if attack_aspect(unit, &enemy) != "front" && attack_aspect(&enemy, unit) != "front" {
                continue;
            }
            adjacency
                .entry(unit.id.clone())
                .or_default()
                .insert(enemy.id.clone());
            adjacency
                .entry(enemy.id.clone())
                .or_default()
                .insert(unit.id.clone());
            for participant in [unit, &enemy] {
                let frontage_axis = frontage_step_for_facing(&participant.facing);
                for step in [-1, 1] {
                    let neighbor = units_by_pos.get(&(
                        participant.position.x + (frontage_axis.0 * step),
                        participant.position.y + (frontage_axis.1 * step),
                    ));
                    if let Some(neighbor) = neighbor {
                        if neighbor.army != participant.army
                            || neighbor.facing != participant.facing
                        {
                            continue;
                        }
                        adjacency
                            .entry(participant.id.clone())
                            .or_default()
                            .insert(neighbor.id.clone());
                        adjacency
                            .entry(neighbor.id.clone())
                            .or_default()
                            .insert(participant.id.clone());
                    }
                }
            }
        }
    }

    let mut pairs = Vec::new();
    let mut engaged_units = HashSet::new();
    let mut remaining: HashSet<String> = adjacency.keys().cloned().collect();
    while let Some(root) = remaining.iter().min().cloned() {
        let mut stack = vec![root.clone()];
        let mut component = HashSet::new();
        while let Some(unit_id) = stack.pop() {
            if !component.insert(unit_id.clone()) {
                continue;
            }
            if let Some(neighbors) = adjacency.get(&unit_id) {
                for neighbor in neighbors {
                    if !component.contains(neighbor) {
                        stack.push(neighbor.clone());
                    }
                }
            }
        }
        for unit_id in &component {
            remaining.remove(unit_id);
        }
        let component_pairs = frontage_pairs_for_component(state, &component);
        for pair in &component_pairs {
            engaged_units.insert(pair.attacker_id.clone());
            engaged_units.insert(pair.defender_id.clone());
        }
        pairs.extend(component_pairs);
    }

    (pairs, engaged_units)
}

pub(crate) fn pair_is_front_contact(left: &Unit, right: &Unit) -> bool {
    footprints_touch(&left.position, &left.facing, &right.position, &right.facing)
        && (attack_aspect(left, right) == "front" || attack_aspect(right, left) == "front")
}

pub(crate) fn frontage_step_for_facing(facing: &Direction) -> (i32, i32) {
    crate::rules_shared::frontage_step_for_facing(facing)
}

pub(crate) fn lane_value_for_axis(position: &Coord, frontage_axis: (i32, i32)) -> i32 {
    if frontage_axis == (1, 0) {
        position.x
    } else {
        position.y
    }
}

pub(crate) fn depth_value_for_axis(position: &Coord, frontage_axis: (i32, i32)) -> i32 {
    if frontage_axis == (1, 0) {
        position.y
    } else {
        position.x
    }
}

pub(crate) fn build_auxiliary_contact_pairs(
    state: &GameState,
    engaged_units: HashSet<String>,
) -> Vec<CombatPair> {
    let units: Vec<Unit> = state
        .units
        .iter()
        .filter(|unit| !unit.eliminated && !engaged_units.contains(&unit.id))
        .cloned()
        .collect();
    let mut candidates: Vec<(i32, String, String)> = Vec::new();
    for unit in &units {
        for other in front_contact_enemies(state, unit) {
            if engaged_units.contains(&other.id) {
                continue;
            }
            candidates.push((
                aspect_priority(attack_aspect(unit, &other)),
                unit.id.clone(),
                other.id.clone(),
            ));
        }
    }

    let mut locally_engaged: HashSet<String> = HashSet::new();
    let mut pairs = Vec::new();
    candidates.sort_by(|left, right| right.cmp(left));
    for (_, attacker_id, defender_id) in candidates {
        if locally_engaged.contains(&attacker_id) || locally_engaged.contains(&defender_id) {
            continue;
        }
        locally_engaged.insert(attacker_id.clone());
        locally_engaged.insert(defender_id.clone());
        let Some(attacker_index) = find_unit(state, &attacker_id) else {
            continue;
        };
        let Some(defender_index) = find_unit(state, &defender_id) else {
            continue;
        };
        let attacker = &state.units[attacker_index];
        let defender = &state.units[defender_index];
        pairs.push(CombatPair {
            attacker_id,
            defender_id,
            attacker_aspect: attack_aspect(attacker, defender).to_string(),
            defender_aspect: attack_aspect(defender, attacker).to_string(),
            frontage: None,
        });
    }
    pairs
}

pub(crate) fn frontage_pairs_for_component(
    state: &GameState,
    component: &HashSet<String>,
) -> Vec<CombatPair> {
    if component.is_empty() {
        return Vec::new();
    }

    let mut component_units: Vec<Unit> = component
        .iter()
        .filter_map(|unit_id| find_unit(state, unit_id).map(|index| state.units[index].clone()))
        .collect();
    component_units.sort_by(|left, right| left.id.cmp(&right.id));

    let mut frontage_axis: Option<(i32, i32)> = None;
    for unit in &component_units {
        for enemy in adjacent_enemies(state, unit) {
            if !component.contains(&enemy.id) {
                continue;
            }
            if attack_aspect(unit, &enemy) == "front" {
                frontage_axis = Some(frontage_step_for_facing(&unit.facing));
                break;
            }
            if attack_aspect(&enemy, unit) == "front" {
                frontage_axis = Some(frontage_step_for_facing(&enemy.facing));
                break;
            }
        }
        if frontage_axis.is_some() {
            break;
        }
    }
    let Some(frontage_axis) = frontage_axis else {
        return Vec::new();
    };

    let lines: HashMap<ArmyId, Vec<Unit>> = [ArmyId::A, ArmyId::B]
        .into_iter()
        .map(|army| {
            let line = frontage_line_for_component_army(
                state,
                component_units
                    .iter()
                    .filter(|unit| unit.army == army)
                    .cloned()
                    .collect(),
                frontage_axis,
            );
            (army, line)
        })
        .collect();
    let Some(line_a) = lines.get(&ArmyId::A) else {
        return Vec::new();
    };
    let Some(line_b) = lines.get(&ArmyId::B) else {
        return Vec::new();
    };
    if line_a.is_empty() || line_b.is_empty() {
        return Vec::new();
    }

    let unit_by_lane: HashMap<ArmyId, HashMap<i32, String>> = [ArmyId::A, ArmyId::B]
        .into_iter()
        .map(|army| {
            let mut lanes = HashMap::new();
            for unit in lines.get(&army).into_iter().flat_map(|line| line.iter()) {
                lanes.insert(
                    lane_value_for_axis(&unit.position, frontage_axis),
                    unit.id.clone(),
                );
            }
            (army, lanes)
        })
        .collect();
    let pair_lanes = pair_lanes_for_frontage(state, &unit_by_lane);
    if pair_lanes.is_empty() {
        return Vec::new();
    }

    let line_by_army = [(ArmyId::A, line_a), (ArmyId::B, line_b)]
        .into_iter()
        .map(|(army, line)| (army, line.iter().map(|unit| unit.id.clone()).collect()))
        .collect();
    let lane_value_by_unit = lines
        .values()
        .flat_map(|line| line.iter())
        .map(|unit| {
            (
                unit.id.clone(),
                lane_value_for_axis(&unit.position, frontage_axis),
            )
        })
        .collect();
    let index_by_unit = [line_a, line_b]
        .into_iter()
        .flat_map(|line| {
            line.iter()
                .enumerate()
                .map(|(index, unit)| (unit.id.clone(), index))
        })
        .collect();
    let mut pair_by_unit = HashMap::new();
    for lane in &pair_lanes {
        let Some(a_id) = unit_by_lane
            .get(&ArmyId::A)
            .and_then(|lanes| lanes.get(lane))
            .cloned()
        else {
            return Vec::new();
        };
        let Some(b_id) = unit_by_lane
            .get(&ArmyId::B)
            .and_then(|lanes| lanes.get(lane))
            .cloned()
        else {
            return Vec::new();
        };
        pair_by_unit.insert(a_id.clone(), b_id.clone());
        pair_by_unit.insert(b_id.clone(), a_id.clone());
    }

    let context = FrontageContext {
        line_by_army,
        lane_value_by_unit,
        unit_by_lane: unit_by_lane.clone(),
        index_by_unit,
        pair_by_unit,
    };

    let mut pairs = Vec::with_capacity(pair_lanes.len());
    let attacker_army = state.current_player.clone();
    let defender_army = attacker_army.other();
    for lane in pair_lanes {
        let Some(attacker_id) = unit_by_lane
            .get(&attacker_army)
            .and_then(|lanes| lanes.get(&lane))
            .cloned()
        else {
            return Vec::new();
        };
        let Some(defender_id) = unit_by_lane
            .get(&defender_army)
            .and_then(|lanes| lanes.get(&lane))
            .cloned()
        else {
            return Vec::new();
        };
        pairs.push(CombatPair {
            attacker_id,
            defender_id,
            attacker_aspect: "front".to_string(),
            defender_aspect: "front".to_string(),
            frontage: Some(context.clone()),
        });
    }
    pairs
}

pub(crate) fn pair_lanes_for_frontage(
    state: &GameState,
    unit_by_lane: &HashMap<ArmyId, HashMap<i32, String>>,
) -> Vec<i32> {
    let a_lanes = unit_by_lane.get(&ArmyId::A).cloned().unwrap_or_default();
    let b_lanes = unit_by_lane.get(&ArmyId::B).cloned().unwrap_or_default();
    let mut lanes: Vec<i32> = a_lanes
        .keys()
        .filter(|lane| b_lanes.contains_key(lane))
        .copied()
        .collect();
    lanes.sort_unstable();
    lanes
        .into_iter()
        .filter(|lane| {
            let a = a_lanes
                .get(lane)
                .and_then(|id| find_unit(state, id).map(|index| &state.units[index]));
            let b = b_lanes
                .get(lane)
                .and_then(|id| find_unit(state, id).map(|index| &state.units[index]));
            match (a, b) {
                (Some(a), Some(b)) => pair_is_front_contact(a, b),
                _ => false,
            }
        })
        .collect()
}

pub(crate) fn frontage_line_for_component_army(
    state: &GameState,
    seeds: Vec<Unit>,
    frontage_axis: (i32, i32),
) -> Vec<Unit> {
    if seeds.is_empty() {
        return Vec::new();
    }

    let units_by_pos: HashMap<(i32, i32), Unit> = state
        .units
        .iter()
        .filter(|candidate| !candidate.eliminated)
        .cloned()
        .map(|unit| ((unit.position.x, unit.position.y), unit))
        .collect();
    let mut expanded: HashMap<String, Unit> = HashMap::new();
    let mut stack = seeds;
    while let Some(unit) = stack.pop() {
        if expanded.contains_key(&unit.id) {
            continue;
        }
        expanded.insert(unit.id.clone(), unit.clone());
        for step in [-1, 1] {
            let neighbor = units_by_pos.get(&(
                unit.position.x + (frontage_axis.0 * step),
                unit.position.y + (frontage_axis.1 * step),
            ));
            if let Some(neighbor) = neighbor {
                if neighbor.army != unit.army || neighbor.facing != unit.facing {
                    continue;
                }
                stack.push(neighbor.clone());
            }
        }
    }

    let mut depth_groups: HashMap<i32, Vec<Unit>> = HashMap::new();
    let mut seed_counts: HashMap<i32, usize> = HashMap::new();
    for unit in expanded.values() {
        let depth = depth_value_for_axis(&unit.position, frontage_axis);
        depth_groups.entry(depth).or_default().push(unit.clone());
        *seed_counts.entry(depth).or_insert(0) += 1;
    }

    let Some(preferred_depth) = depth_groups.keys().copied().min_by_key(|depth| {
        let seed_count = seed_counts.get(depth).copied().unwrap_or(0) as i32;
        let len = depth_groups
            .get(depth)
            .map(|group| group.len())
            .unwrap_or(0) as i32;
        (-seed_count, -len, *depth)
    }) else {
        return Vec::new();
    };
    let mut line = depth_groups.remove(&preferred_depth).unwrap_or_default();
    line.sort_by_key(|unit| lane_value_for_axis(&unit.position, frontage_axis));
    line
}
