use super::*;

#[cfg(test)]
pub(crate) fn movement_endpoints(
    state: &GameState,
    unit: &Unit,
    occupied: &HashMap<(i32, i32), String>,
) -> MovementEndpoints {
    let indexes = GameIndexes::new(state);
    movement_endpoints_with_indexes(state, &indexes, unit, occupied)
}

pub(crate) fn movement_endpoints_with_indexes(
    state: &GameState,
    indexes: &GameIndexes,
    unit: &Unit,
    occupied: &HashMap<(i32, i32), String>,
) -> MovementEndpoints {
    let movement_limit = unit_profile(&unit.kind).movement;
    let mut moves = Vec::new();
    let mut charges = Vec::new();
    let mut queue: VecDeque<(Coord, Direction, i32, Vec<Coord>, bool)> = VecDeque::from([(
        unit.position.clone(),
        unit.facing.clone(),
        0,
        Vec::new(),
        false,
    )]);
    let mut best_cost: HashMap<(i32, i32, usize, bool), i32> = HashMap::from([(
        (
            unit.position.x,
            unit.position.y,
            direction_index(&unit.facing),
            false,
        ),
        0,
    )]);

    while let Some((position, facing, spent, path, through_friend)) = queue.pop_front() {
        if !through_friend {
            for new_facing in ROTATION_ORDER {
                let turn_cost = rotation_cost(&facing, &new_facing);
                if turn_cost == 0 {
                    continue;
                }
                let total_cost = spent + turn_cost;
                if total_cost > movement_limit {
                    continue;
                }
                let key = (position.x, position.y, direction_index(&new_facing), false);
                if total_cost >= *best_cost.get(&key).unwrap_or(&i32::MAX) {
                    continue;
                }
                best_cost.insert(key, total_cost);
                queue.push_back((
                    position.clone(),
                    new_facing,
                    total_cost,
                    path.clone(),
                    false,
                ));
            }
        }

        let (dx, dy) = direction_delta(&facing);
        let candidate = Coord {
            x: position.x + dx,
            y: position.y + dy,
        };
        let Some(enter_cost) =
            placement_cost_with_indexes(state, indexes, unit, &candidate, Some(&facing))
        else {
            continue;
        };
        let total_cost = spent + enter_cost;
        if total_cost > movement_limit {
            continue;
        }

        let occupant = occupied
            .get(&(candidate.x, candidate.y))
            .and_then(|occupant_id| {
                if occupant_id == &unit.id {
                    None
                } else {
                    indexes.find_unit(state, occupant_id)
                }
            });
        let occupant_is_pass_through = occupant.is_some_and(|occupant| {
            can_interpenetrate_through_with_indexes(state, indexes, unit, occupant)
        });
        if occupant.is_some() && !occupant_is_pass_through {
            continue;
        }

        let mut candidate_path = path.clone();
        candidate_path.push(candidate.clone());
        if occupant_is_pass_through {
            let key = (candidate.x, candidate.y, direction_index(&facing), true);
            if total_cost >= *best_cost.get(&key).unwrap_or(&i32::MAX) {
                continue;
            }
            best_cost.insert(key, total_cost);
            queue.push_back((candidate, facing, total_cost, candidate_path, true));
            continue;
        }

        let ignored = HashSet::from([unit.id.clone()]);
        let adjacent = adjacent_enemies_at_with_indexes(
            state,
            indexes,
            &unit.army,
            &candidate,
            &facing,
            Some(&ignored),
        );
        if adjacent.len() == 1 {
            if let Some(charge_facing) = charge_facing_for_target(&candidate, adjacent[0]) {
                charges.push(ChargeCandidate {
                    destination: candidate,
                    path: candidate_path,
                    facing: charge_facing,
                    defender: (*adjacent[0]).clone(),
                });
            }
            continue;
        }
        if adjacent.len() > 1 {
            continue;
        }

        if !threat_generators_at_with_indexes(
            state,
            indexes,
            &unit.army,
            &candidate,
            Some(&ignored),
        )
        .is_empty()
        {
            let key = (candidate.x, candidate.y, direction_index(&facing), false);
            if total_cost < *best_cost.get(&key).unwrap_or(&i32::MAX) {
                best_cost.insert(key, total_cost);
                moves.push(MoveCandidate {
                    destination: candidate.clone(),
                    path: candidate_path.clone(),
                    facing: facing.clone(),
                    spent: total_cost,
                });
            }
            continue;
        }

        let key = (candidate.x, candidate.y, direction_index(&facing), false);
        if total_cost >= *best_cost.get(&key).unwrap_or(&i32::MAX) {
            continue;
        }
        best_cost.insert(key, total_cost);
        moves.push(MoveCandidate {
            destination: candidate.clone(),
            path: candidate_path.clone(),
            facing: facing.clone(),
            spent: total_cost,
        });
        queue.push_back((candidate, facing, total_cost, candidate_path, false));
    }

    MovementEndpoints {
        moves: canonicalise_move_candidates(unit, moves),
        charges: canonicalise_charge_candidates(charges),
    }
}

pub(crate) fn canonicalise_move_candidates(
    unit: &Unit,
    candidates: Vec<MoveCandidate>,
) -> Vec<MoveCandidate> {
    let mut deduped: HashMap<(i32, i32, usize), MoveCandidate> = HashMap::new();
    for candidate in candidates {
        let key = (
            candidate.destination.x,
            candidate.destination.y,
            direction_index(&candidate.facing),
        );
        let replace = match deduped.get(&key) {
            None => true,
            Some(current) => {
                move_candidate_rank(unit, &candidate) < move_candidate_rank(unit, current)
            }
        };
        if replace {
            deduped.insert(key, candidate);
        }
    }
    let mut values: Vec<MoveCandidate> = deduped.into_values().collect();
    values.sort_by_key(|value| {
        (
            value.destination.y,
            value.destination.x,
            value.spent,
            direction_index(&value.facing),
        )
    });
    values
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TerrainTile;

    fn sample_unit() -> Unit {
        Unit {
            id: "u1".to_string(),
            army: ArmyId::A,
            name: "Sample".to_string(),
            kind: UnitKind::Spear,
            position: Coord { x: 0, y: 0 },
            facing: Direction::N,
            leader: false,
            formation_class: FormationClass::CloseOrder,
            quality: UnitQuality::Ordinary,
            in_command: true,
            disordered: false,
            can_evade: false,
            activated_this_bound: false,
            charging: false,
            eliminated: false,
            unit_class: UnitClass::Formed,
            formation_state: FormationState::Normal,
            pursuit_class: PursuitClass::None,
            morale_value: 3,
            has_routed_before: false,
            overpursuit_turns_remaining: 0,
            panic_turns_remaining: 0,
            army_general: false,
            deployed: true,
            off_map: false,
        }
    }

    fn missile_test_state(units: Vec<Unit>, terrain: Vec<TerrainTile>) -> GameState {
        GameState {
            game_id: "test".to_string(),
            engine_name: "test".to_string(),
            engine_version: "test".to_string(),
            design_basis: "test".to_string(),
            scenario_id: "test".to_string(),
            scenario_name: "test".to_string(),
            board_width: 16,
            board_height: 16,
            phase: GamePhase::Battle,
            bound_number: 1,
            current_player: ArmyId::A,
            deployment_first_army: ArmyId::A,
            first_bound_army: ArmyId::A,
            pips_remaining: 4,
            last_pip_roll: 4,
            seed: 1,
            roll_index: 0,
            winner: None,
            draw: false,
            terrain,
            deployment_zones: Vec::new(),
            deployment_ready: Vec::new(),
            attrition_status: Vec::new(),
            battle_scores: Vec::new(),
            armies: Vec::new(),
            victory_target: 5,
            units,
            log: Vec::new(),
            recent_resolutions: Vec::new(),
            pending_shots: Vec::new(),
            endgame_deadline_bound: None,
            winner_reason: None,
            use_endgame_clock: false,
        }
    }

    fn unit_with_position(
        id: &str,
        army: ArmyId,
        kind: UnitKind,
        position: Coord,
        facing: Direction,
        formation_class: FormationClass,
    ) -> Unit {
        Unit {
            id: id.to_string(),
            army,
            name: id.to_string(),
            kind: kind.clone(),
            position,
            facing,
            leader: false,
            formation_class,
            quality: UnitQuality::Ordinary,
            in_command: true,
            disordered: false,
            can_evade: false,
            activated_this_bound: false,
            charging: false,
            eliminated: false,
            unit_class: unit_class_for_kind(&kind, false),
            formation_state: FormationState::Normal,
            pursuit_class: pursuit_class_for_kind(&kind, false),
            morale_value: morale_value_for_kind(&kind, false),
            has_routed_before: false,
            overpursuit_turns_remaining: 0,
            panic_turns_remaining: 0,
            army_general: false,
            deployed: true,
            off_map: false,
        }
    }

    #[test]
    fn general_command_radius_extends_one_more_tile() {
        let mut general = unit_with_position(
            "gen",
            ArmyId::A,
            UnitKind::Knights,
            Coord { x: 0, y: 0 },
            Direction::N,
            FormationClass::CloseOrder,
        );
        general.leader = true;
        let in_range = unit_with_position(
            "in-range",
            ArmyId::A,
            UnitKind::Spear,
            Coord { x: 8, y: 0 },
            Direction::N,
            FormationClass::CloseOrder,
        );
        let out_of_range = unit_with_position(
            "out-of-range",
            ArmyId::A,
            UnitKind::Spear,
            Coord { x: 9, y: 0 },
            Direction::N,
            FormationClass::CloseOrder,
        );
        let state = missile_test_state(
            vec![general, in_range.clone(), out_of_range.clone()],
            Vec::new(),
        );

        assert_eq!(command_radius_for_army(&state, &ArmyId::A), 8);
        assert!(is_in_command(&state, &in_range));
        assert!(!is_in_command(&state, &out_of_range));
    }

    #[test]
    fn canonicalise_move_candidates_keeps_distinct_facings() {
        let unit = sample_unit();
        let destination = Coord { x: 1, y: 0 };
        let candidates = vec![
            MoveCandidate {
                destination: destination.clone(),
                path: vec![destination.clone()],
                facing: Direction::E,
                spent: 1,
            },
            MoveCandidate {
                destination,
                path: vec![Coord { x: 1, y: 0 }],
                facing: Direction::N,
                spent: 1,
            },
        ];

        let canonical = canonicalise_move_candidates(&unit, candidates);

        assert_eq!(canonical.len(), 2);
        assert!(canonical
            .iter()
            .any(|candidate| candidate.facing == Direction::E));
        assert!(canonical
            .iter()
            .any(|candidate| candidate.facing == Direction::N));
    }

    #[test]
    fn movement_endpoints_keep_current_facing_when_entering_threat() {
        let mover = unit_with_position(
            "mover",
            ArmyId::A,
            UnitKind::Cavalry,
            Coord { x: 3, y: 5 },
            Direction::N,
            FormationClass::CloseOrder,
        );
        let enemy = unit_with_position(
            "enemy",
            ArmyId::B,
            UnitKind::Spear,
            Coord { x: 4, y: 2 },
            Direction::S,
            FormationClass::CloseOrder,
        );
        let state = missile_test_state(vec![mover.clone(), enemy], Vec::new());
        let occupied = occupied_cells(&state);

        let endpoints = movement_endpoints(&state, &mover, &occupied);
        let threat_stop = endpoints
            .moves
            .into_iter()
            .find(|candidate| candidate.destination == (Coord { x: 3, y: 3 }));

        assert_eq!(
            threat_stop.as_ref().map(|candidate| &candidate.facing),
            Some(&Direction::N)
        );
    }

    #[test]
    fn visible_enemies_in_sector_includes_off_ray_targets_in_front() {
        let shooter = unit_with_position(
            "archer",
            ArmyId::A,
            UnitKind::Bow,
            Coord { x: 7, y: 5 },
            Direction::N,
            FormationClass::CloseOrder,
        );
        let visible_targets = vec![
            unit_with_position(
                "enemy-left",
                ArmyId::B,
                UnitKind::Spear,
                Coord { x: 5, y: 1 },
                Direction::S,
                FormationClass::CloseOrder,
            ),
            unit_with_position(
                "enemy-center",
                ArmyId::B,
                UnitKind::Spear,
                Coord { x: 7, y: 1 },
                Direction::S,
                FormationClass::CloseOrder,
            ),
            unit_with_position(
                "enemy-right",
                ArmyId::B,
                UnitKind::Spear,
                Coord { x: 9, y: 1 },
                Direction::S,
                FormationClass::CloseOrder,
            ),
        ];
        let hidden_target = unit_with_position(
            "enemy-wide",
            ArmyId::B,
            UnitKind::Spear,
            Coord { x: 10, y: 1 },
            Direction::S,
            FormationClass::CloseOrder,
        );
        let mut units = vec![shooter.clone()];
        units.extend(visible_targets.clone());
        units.push(hidden_target);
        let state = missile_test_state(units, Vec::new());

        let occupied = occupied_cells(&state);
        let visible = visible_enemies_in_sector(&state, &shooter, &occupied);
        let visible_ids: Vec<&str> = visible.iter().map(|(unit, _)| unit.id.as_str()).collect();

        assert_eq!(
            visible_ids,
            vec!["enemy-center", "enemy-left", "enemy-right"]
        );
    }

    #[test]
    fn visible_enemies_in_sector_blocks_targets_behind_other_units() {
        let shooter = unit_with_position(
            "archer",
            ArmyId::A,
            UnitKind::Bow,
            Coord { x: 7, y: 5 },
            Direction::N,
            FormationClass::CloseOrder,
        );
        let blocker = unit_with_position(
            "blocker",
            ArmyId::B,
            UnitKind::Spear,
            Coord { x: 7, y: 3 },
            Direction::S,
            FormationClass::CloseOrder,
        );
        let hidden = unit_with_position(
            "hidden",
            ArmyId::B,
            UnitKind::Spear,
            Coord { x: 7, y: 1 },
            Direction::S,
            FormationClass::CloseOrder,
        );
        let state = missile_test_state(vec![shooter.clone(), blocker, hidden], Vec::new());

        let occupied = occupied_cells(&state);
        let visible = visible_enemies_in_sector(&state, &shooter, &occupied);
        let visible_ids: Vec<&str> = visible.iter().map(|(unit, _)| unit.id.as_str()).collect();

        assert_eq!(visible_ids, vec!["blocker"]);
    }

    #[test]
    fn visible_enemies_in_sector_allows_one_screen_but_not_double_obscuration() {
        let shooter = unit_with_position(
            "archer",
            ArmyId::A,
            UnitKind::Bow,
            Coord { x: 7, y: 5 },
            Direction::N,
            FormationClass::CloseOrder,
        );
        let screen = unit_with_position(
            "screen",
            ArmyId::A,
            UnitKind::Psiloi,
            Coord { x: 7, y: 4 },
            Direction::N,
            FormationClass::OpenOrder,
        );
        let target = unit_with_position(
            "target",
            ArmyId::B,
            UnitKind::Spear,
            Coord { x: 7, y: 2 },
            Direction::S,
            FormationClass::CloseOrder,
        );
        let terrain = vec![TerrainTile {
            position: Coord { x: 7, y: 3 },
            terrain: TerrainType::Hill,
        }];

        let clear_state = missile_test_state(
            vec![shooter.clone(), screen.clone(), target.clone()],
            Vec::new(),
        );
        let blocked_state = missile_test_state(vec![shooter.clone(), screen, target], terrain);

        let clear_visible =
            visible_enemies_in_sector(&clear_state, &shooter, &occupied_cells(&clear_state));
        let blocked_visible =
            visible_enemies_in_sector(&blocked_state, &shooter, &occupied_cells(&blocked_state));

        assert_eq!(clear_visible.len(), 1);
        assert!(blocked_visible.is_empty());
    }
}

pub(crate) fn canonicalise_charge_candidates(
    candidates: Vec<ChargeCandidate>,
) -> Vec<ChargeCandidate> {
    let mut deduped: HashMap<(String, i32, i32), ChargeCandidate> = HashMap::new();
    for candidate in candidates {
        let key = (
            candidate.defender.id.clone(),
            candidate.destination.x,
            candidate.destination.y,
        );
        let replace = match deduped.get(&key) {
            None => true,
            Some(current) => candidate.path.len() < current.path.len(),
        };
        if replace {
            deduped.insert(key, candidate);
        }
    }
    let mut values: Vec<ChargeCandidate> = deduped.into_values().collect();
    values.sort_by_key(|value| {
        (
            value.destination.y,
            value.destination.x,
            value.defender.id.clone(),
        )
    });
    values
}

pub(crate) fn move_candidate_rank(
    unit: &Unit,
    candidate: &MoveCandidate,
) -> (i32, i32, i32, usize) {
    let mut step_facing = candidate.facing.clone();
    if let Some(last) = candidate.path.last() {
        let previous = if candidate.path.len() == 1 {
            &unit.position
        } else {
            &candidate.path[candidate.path.len() - 2]
        };
        step_facing = direction_between(previous, last);
    }
    (
        candidate.spent,
        if candidate.facing == unit.facing {
            0
        } else {
            1
        },
        if candidate.facing == step_facing {
            0
        } else {
            1
        },
        direction_index(&candidate.facing),
    )
}

pub(crate) fn march_endpoints_with_indexes(
    state: &GameState,
    indexes: &GameIndexes,
    unit: &Unit,
    occupied: &HashMap<(i32, i32), String>,
) -> Vec<MoveCandidate> {
    let profile = unit_profile(&unit.kind);
    if profile.march_bonus <= 0 {
        return Vec::new();
    }
    let ignored = HashSet::from([unit.id.clone()]);
    if !threat_generators_at_with_indexes(
        state,
        indexes,
        &unit.army,
        &unit.position,
        Some(&ignored),
    )
    .is_empty()
    {
        return Vec::new();
    }

    let mut results = Vec::new();
    let (dx, dy) = direction_delta(&unit.facing);
    let mut path: Vec<Coord> = Vec::new();
    let mut spent = 0;
    let max_distance = profile.movement + profile.march_bonus;
    for distance in 1..=max_distance {
        let candidate = Coord {
            x: unit.position.x + (dx * distance),
            y: unit.position.y + (dy * distance),
        };
        let Some(enter_cost) =
            placement_cost_with_indexes(state, indexes, unit, &candidate, Some(&unit.facing))
        else {
            break;
        };
        if !matches!(
            terrain_at_with_indexes(indexes, &candidate),
            TerrainType::Open | TerrainType::Road
        ) {
            break;
        }
        if !threat_generators_at_with_indexes(
            state,
            indexes,
            &unit.army,
            &candidate,
            Some(&ignored),
        )
        .is_empty()
        {
            break;
        }
        let occupant = occupied
            .get(&(candidate.x, candidate.y))
            .and_then(|occupant_id| {
                if occupant_id == &unit.id {
                    None
                } else {
                    indexes.find_unit(state, occupant_id)
                }
            });
        if occupant.is_some() {
            break;
        }
        spent += enter_cost;
        if spent > max_distance {
            break;
        }
        path.push(candidate.clone());
        if distance <= profile.movement {
            continue;
        }
        if !adjacent_enemies_at_with_indexes(
            state,
            indexes,
            &unit.army,
            &candidate,
            &unit.facing,
            Some(&ignored),
        )
        .is_empty()
        {
            break;
        }
        results.push(MoveCandidate {
            destination: candidate.clone(),
            path: path.clone(),
            facing: unit.facing.clone(),
            spent,
        });
    }
    results
}

pub(crate) fn group_move_path(
    unit: &Unit,
    dx: i32,
    dy: i32,
    distance: i32,
    incline: (i32, i32),
) -> Vec<Coord> {
    let mut path = (1..=distance)
        .map(|step| Coord {
            x: unit.position.x + (dx * step),
            y: unit.position.y + (dy * step),
        })
        .collect::<Vec<_>>();
    if incline != (0, 0) {
        if let Some(last) = path.last().cloned() {
            path.push(Coord {
                x: last.x + incline.0,
                y: last.y + incline.1,
            });
        }
    }
    path
}

pub(crate) fn enumerate_groups_with_indexes(
    state: &GameState,
    indexes: &GameIndexes,
) -> Vec<Vec<String>> {
    let mut eligible_units: Vec<&Unit> = indexes
        .active_units(state, &state.current_player)
        .filter(|unit| !unit.activated_this_bound)
        .collect();
    eligible_units.sort_by(|left, right| left.id.cmp(&right.id));
    let units_by_pos: HashMap<(i32, i32), &Unit> = eligible_units
        .iter()
        .map(|unit| ((unit.position.x, unit.position.y), *unit))
        .collect();
    let mut groups: HashMap<Vec<String>, Vec<String>> = HashMap::new();

    for unit in eligible_units {
        let axes = [
            frontage_step_for_facing(&unit.facing),
            direction_delta(&unit.facing),
        ];
        for (axis_dx, axis_dy) in axes {
            let previous =
                units_by_pos.get(&(unit.position.x - axis_dx, unit.position.y - axis_dy));
            if previous.is_some_and(|previous| previous.facing == unit.facing) {
                continue;
            }

            let mut segment = vec![unit];
            let mut next_x = unit.position.x + axis_dx;
            let mut next_y = unit.position.y + axis_dy;
            loop {
                let Some(next_unit) = units_by_pos.get(&(next_x, next_y)) else {
                    break;
                };
                if next_unit.facing != unit.facing || next_unit.activated_this_bound {
                    break;
                }
                segment.push(next_unit);
                next_x += axis_dx;
                next_y += axis_dy;
            }

            if segment.len() < 2 {
                continue;
            }

            for start in 0..(segment.len() - 1) {
                for end in (start + 2)..=segment.len() {
                    let candidate: Vec<String> = segment[start..end]
                        .iter()
                        .map(|member| member.id.clone())
                        .collect();
                    groups.insert(candidate.clone(), candidate);
                }
            }
        }
    }

    groups.into_values().collect()
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn group_translation_is_valid_with_indexes(
    state: &GameState,
    indexes: &GameIndexes,
    group_units: &[&Unit],
    occupied: &HashMap<(i32, i32), String>,
    dx: i32,
    dy: i32,
    distance: i32,
    ignored_unit_ids: &HashSet<String>,
    incline: (i32, i32),
) -> bool {
    let mut destinations: HashSet<(i32, i32)> = HashSet::new();
    for unit in group_units {
        let mut spent = 0;
        for step in 1..=distance {
            let nx = unit.position.x + (dx * step);
            let ny = unit.position.y + (dy * step);
            let coord = Coord { x: nx, y: ny };
            if !placement_is_clear(&coord, &unit.facing, occupied, Some(ignored_unit_ids)) {
                return false;
            }
            let Some(enter_cost) =
                placement_cost_with_indexes(state, indexes, unit, &coord, Some(&unit.facing))
            else {
                return false;
            };
            spent += enter_cost;
            if !adjacent_enemies_at_with_indexes(
                state,
                indexes,
                &unit.army,
                &coord,
                &unit.facing,
                Some(ignored_unit_ids),
            )
            .is_empty()
            {
                return false;
            }
            if !threat_generators_at_with_indexes(
                state,
                indexes,
                &unit.army,
                &coord,
                Some(ignored_unit_ids),
            )
            .is_empty()
            {
                return false;
            }
        }
        if spent > unit_profile(&unit.kind).movement {
            return false;
        }

        let destination = Coord {
            x: unit.position.x + (dx * distance) + incline.0,
            y: unit.position.y + (dy * distance) + incline.1,
        };
        if !placement_is_clear(&destination, &unit.facing, occupied, Some(ignored_unit_ids)) {
            return false;
        }
        if !can_enter_cell_with_indexes(state, indexes, unit, &destination, Some(&unit.facing)) {
            return false;
        }
        if !adjacent_enemies_at_with_indexes(
            state,
            indexes,
            &unit.army,
            &destination,
            &unit.facing,
            Some(ignored_unit_ids),
        )
        .is_empty()
        {
            return false;
        }
        if !threat_generators_at_with_indexes(
            state,
            indexes,
            &unit.army,
            &destination,
            Some(ignored_unit_ids),
        )
        .is_empty()
        {
            return false;
        }
        destinations.insert((destination.x, destination.y));
    }

    destinations.len() == group_units.len()
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn group_march_translation_is_valid_with_indexes(
    state: &GameState,
    indexes: &GameIndexes,
    group_units: &[&Unit],
    occupied: &HashMap<(i32, i32), String>,
    dx: i32,
    dy: i32,
    distance: i32,
    ignored_unit_ids: &HashSet<String>,
) -> bool {
    let max_distance = group_units
        .iter()
        .map(|unit| unit_profile(&unit.kind).movement + unit_profile(&unit.kind).march_bonus)
        .min()
        .unwrap_or(0);
    for unit in group_units {
        let mut spent = 0;
        for step in 1..=distance {
            let coord = Coord {
                x: unit.position.x + (dx * step),
                y: unit.position.y + (dy * step),
            };
            if !placement_is_clear(&coord, &unit.facing, occupied, Some(ignored_unit_ids)) {
                return false;
            }
            if !can_enter_cell_with_indexes(state, indexes, unit, &coord, Some(&unit.facing)) {
                return false;
            }
            if !matches!(
                terrain_at_with_indexes(indexes, &coord),
                TerrainType::Open | TerrainType::Road
            ) {
                return false;
            }
            if !threat_generators_at_with_indexes(
                state,
                indexes,
                &unit.army,
                &coord,
                Some(ignored_unit_ids),
            )
            .is_empty()
            {
                return false;
            }
            if !adjacent_enemies_at_with_indexes(
                state,
                indexes,
                &unit.army,
                &coord,
                &unit.facing,
                Some(ignored_unit_ids),
            )
            .is_empty()
            {
                return false;
            }
            let Some(enter_cost) =
                placement_cost_with_indexes(state, indexes, unit, &coord, Some(&unit.facing))
            else {
                return false;
            };
            spent += enter_cost;
            if spent > max_distance {
                return false;
            }
        }
    }
    true
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn group_charge_translation_with_indexes(
    state: &GameState,
    indexes: &GameIndexes,
    group_units: &[&Unit],
    occupied: &HashMap<(i32, i32), String>,
    dx: i32,
    dy: i32,
    distance: i32,
    ignored_unit_ids: &HashSet<String>,
) -> Option<Vec<GroupChargeStep>> {
    let mut steps = Vec::new();
    let mut destinations: HashSet<(i32, i32)> = HashSet::new();
    let mut target_ids: HashSet<String> = HashSet::new();
    for unit in group_units {
        let mut spent = 0;
        for step in 1..=distance {
            let nx = unit.position.x + (dx * step);
            let ny = unit.position.y + (dy * step);
            let coord = Coord { x: nx, y: ny };
            if !placement_is_clear(&coord, &unit.facing, occupied, Some(ignored_unit_ids)) {
                return None;
            }
            let enter_cost =
                placement_cost_with_indexes(state, indexes, unit, &coord, Some(&unit.facing))?;
            spent += enter_cost;

            let adjacent = front_contact_enemies_at_with_indexes(
                state,
                indexes,
                &unit.army,
                &coord,
                &unit.facing,
                Some(ignored_unit_ids),
            );
            if step < distance {
                if !adjacent.is_empty() {
                    return None;
                }
                continue;
            }

            if spent > unit_profile(&unit.kind).movement {
                return None;
            }
            if adjacent.len() != 1 {
                return None;
            }

            let target = adjacent[0];
            let moved_unit = Unit {
                position: coord.clone(),
                facing: unit.facing.clone(),
                ..(*unit).clone()
            };
            if attack_aspect(&moved_unit, target) != "front" {
                return None;
            }

            destinations.insert((coord.x, coord.y));
            if !target_ids.insert(target.id.clone()) {
                return None;
            }
            steps.push(GroupChargeStep {
                unit_id: unit.id.clone(),
                target_id: target.id.clone(),
                destination: coord,
                path: group_move_path(unit, dx, dy, distance, (0, 0)),
                facing: unit.facing.clone(),
            });
        }

        if spent > unit_profile(&unit.kind).movement {
            return None;
        }
    }

    if destinations.len() == group_units.len() {
        Some(steps)
    } else {
        None
    }
}
