use super::*;

pub(crate) fn format_coord(coord: &Coord) -> String {
    format!("({}, {})", coord.x, coord.y)
}

pub(crate) fn format_path(path: &[Coord]) -> String {
    path.iter()
        .map(format_coord)
        .collect::<Vec<_>>()
        .join(" -> ")
}

pub(crate) fn append_log(state: &mut GameState, message: String) {
    let step = state.log.len() as i32 + 1;
    state.log.push(LogEntry { step, message });
}

pub(crate) fn deterministic_keyed_die(seed: u64, key: &str) -> i32 {
    let digest = Sha256::digest(format!("{seed}:{key}").as_bytes());
    i32::from((digest[0] % 6) + 1)
}

fn canonical_roll_unit_id(unit_id: &str) -> &str {
    unit_id
        .strip_prefix("A-")
        .or_else(|| unit_id.strip_prefix("B-"))
        .unwrap_or(unit_id)
}

pub(crate) fn local_combat_die_roll(
    state: &mut GameState,
    kind: &str,
    primary: &Unit,
    secondary: &Unit,
    roller: &Unit,
) -> i32 {
    let primary_key = canonical_roll_unit_id(&primary.id);
    let secondary_key = canonical_roll_unit_id(&secondary.id);
    let roller_key = canonical_roll_unit_id(&roller.id);
    let roller_role = if roller.id == primary.id {
        "primary"
    } else if roller.id == secondary.id {
        "secondary"
    } else {
        "unknown"
    };
    let (left, right) = if primary_key <= secondary_key {
        (primary_key, secondary_key)
    } else {
        (secondary_key, primary_key)
    };
    let key = format!(
        "{kind}:bound{}:{left}:{right}:roller:{roller_key}:{roller_role}",
        state.bound_number
    );
    state.roll_index += 1;
    deterministic_keyed_die(state.seed, &key)
}

pub(crate) fn role_neutral_combat_die_roll(
    state: &mut GameState,
    kind: &str,
    primary: &Unit,
    secondary: &Unit,
    roller: &Unit,
) -> i32 {
    let primary_key = canonical_roll_unit_id(&primary.id);
    let secondary_key = canonical_roll_unit_id(&secondary.id);
    let roller_key = if primary_key == secondary_key {
        roller.id.as_str()
    } else {
        canonical_roll_unit_id(&roller.id)
    };
    let (left, right) = if primary_key <= secondary_key {
        (primary_key, secondary_key)
    } else {
        (secondary_key, primary_key)
    };
    let key = format!(
        "{kind}:neutral:bound{}:{left}:{right}:roller:{roller_key}",
        state.bound_number
    );
    state.roll_index += 1;
    deterministic_keyed_die(state.seed, &key)
}

pub(crate) fn enemy_army(army: &ArmyId) -> ArmyId {
    army.other()
}

pub(crate) fn format_army(army: &ArmyId) -> &'static str {
    match army {
        ArmyId::A => "A",
        ArmyId::B => "B",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_unit(id: &str) -> Unit {
        Unit {
            id: id.to_string(),
            army: if id.starts_with("A-") {
                ArmyId::A
            } else {
                ArmyId::B
            },
            name: id.to_string(),
            kind: UnitKind::Pike,
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
            unit_class: UnitClass::Pike,
            formation_state: FormationState::OrderedPike,
            pursuit_class: PursuitClass::None,
            morale_value: 4,
            has_routed_before: false,
            overpursuit_turns_remaining: 0,
            panic_turns_remaining: 0,
            army_general: false,
            deployed: true,
            off_map: false,
        }
    }

    fn test_state(seed: u64) -> GameState {
        GameState {
            game_id: "test".to_string(),
            engine_name: "test".to_string(),
            engine_version: "0".to_string(),
            design_basis: "test".to_string(),
            scenario_id: "test".to_string(),
            scenario_name: "test".to_string(),
            board_width: 4,
            board_height: 4,
            phase: GamePhase::Battle,
            bound_number: 3,
            current_player: ArmyId::A,
            deployment_first_army: ArmyId::A,
            first_bound_army: ArmyId::A,
            pips_remaining: 4,
            last_pip_roll: 4,
            seed,
            roll_index: 0,
            terrain: Vec::new(),
            deployment_zones: Vec::new(),
            deployment_ready: Vec::new(),
            attrition_status: Vec::new(),
            battle_scores: Vec::new(),
            armies: Vec::new(),
            victory_target: 5,
            units: Vec::new(),
            log: Vec::new(),
            recent_resolutions: Vec::new(),
            pending_shots: Vec::new(),
            endgame_deadline_bound: None,
            winner: None,
            draw: false,
            winner_reason: None,
            use_endgame_clock: false,
        }
    }

    #[test]
    fn local_combat_die_roll_ignores_global_roll_order() {
        let attacker = test_unit("A-PK1");
        let defender = test_unit("B-PK2");
        let mut first = test_state(7);
        let mut second = test_state(7);

        let attacker_roll =
            local_combat_die_roll(&mut first, "close", &attacker, &defender, &attacker);
        let defender_roll =
            local_combat_die_roll(&mut first, "close", &attacker, &defender, &defender);

        second.roll_index = 99;
        let defender_roll_late =
            local_combat_die_roll(&mut second, "close", &attacker, &defender, &defender);
        let attacker_roll_late =
            local_combat_die_roll(&mut second, "close", &attacker, &defender, &attacker);

        assert_eq!(attacker_roll, attacker_roll_late);
        assert_eq!(defender_roll, defender_roll_late);
    }

    #[test]
    fn local_combat_die_roll_normalizes_army_prefixes() {
        let a_attacker = test_unit("A-PK1");
        let b_defender = test_unit("B-PK2");
        let b_attacker = test_unit("B-PK1");
        let a_defender = test_unit("A-PK2");
        let mut first = test_state(8);
        let mut second = test_state(8);

        let first_roll =
            local_combat_die_roll(&mut first, "close", &a_attacker, &b_defender, &a_attacker);
        let mirrored_roll =
            local_combat_die_roll(&mut second, "close", &b_attacker, &a_defender, &b_attacker);

        assert_eq!(first_roll, mirrored_roll);
    }

    #[test]
    fn local_combat_die_roll_distinguishes_matching_unit_suffixes() {
        let attacker = test_unit("A-PK1");
        let defender = test_unit("B-PK1");
        let mut state = test_state(2);

        let attacker_roll =
            local_combat_die_roll(&mut state, "close", &attacker, &defender, &attacker);
        let defender_roll =
            local_combat_die_roll(&mut state, "close", &attacker, &defender, &defender);

        assert_ne!(attacker_roll, defender_roll);
    }

    #[test]
    fn role_neutral_combat_die_roll_distinguishes_matching_unit_suffixes() {
        let attacker = test_unit("A-PK1");
        let defender = test_unit("B-PK1");
        let mut state = test_state(2);

        let attacker_roll =
            role_neutral_combat_die_roll(&mut state, "close", &attacker, &defender, &attacker);
        let defender_roll =
            role_neutral_combat_die_roll(&mut state, "close", &attacker, &defender, &defender);

        assert_ne!(attacker_roll, defender_roll);
    }
}
