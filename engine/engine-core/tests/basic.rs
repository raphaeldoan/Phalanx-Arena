use engine_core::{
    combat, morale_value_for_kind, pursuit_class_for_kind, unit_class_for_kind, Action, ArmyId,
    Coord, Direction, EngineCore, FastGameHandle, FormationClass, FormationState, GamePhase,
    GameState, LegalAction, ScenarioArmy, ScenarioDefinition, ScenarioUnit, TerrainTile,
    TerrainType, Unit, UnitKind, UnitQuality,
};

fn test_formation_class(kind: &UnitKind) -> FormationClass {
    match kind {
        UnitKind::Auxilia
        | UnitKind::Bow
        | UnitKind::Slinger
        | UnitKind::Psiloi
        | UnitKind::LightHorse
        | UnitKind::BowCavalry => FormationClass::OpenOrder,
        _ => FormationClass::CloseOrder,
    }
}

fn test_unit(id: &str, army: ArmyId, kind: UnitKind, position: Coord, facing: Direction) -> Unit {
    let can_evade = matches!(
        kind,
        UnitKind::Psiloi | UnitKind::LightHorse | UnitKind::BowCavalry
    );
    Unit {
        id: id.to_string(),
        army,
        name: id.to_string(),
        kind: kind.clone(),
        position,
        facing,
        leader: false,
        formation_class: test_formation_class(&kind),
        quality: UnitQuality::Ordinary,
        in_command: true,
        disordered: false,
        can_evade,
        activated_this_bound: false,
        charging: false,
        eliminated: false,
        unit_class: unit_class_for_kind(&kind, false),
        formation_state: if matches!(&kind, UnitKind::Pike | UnitKind::GuardPike) {
            FormationState::OrderedPike
        } else {
            FormationState::Normal
        },
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

fn test_state(units: Vec<Unit>, current_player: ArmyId, seed: u64) -> GameState {
    GameState {
        game_id: "test".to_string(),
        engine_name: "test".to_string(),
        engine_version: "test".to_string(),
        design_basis: "test".to_string(),
        scenario_id: "test".to_string(),
        scenario_name: "test".to_string(),
        board_width: 8,
        board_height: 8,
        phase: GamePhase::Battle,
        bound_number: 1,
        current_player,
        deployment_first_army: ArmyId::A,
        first_bound_army: ArmyId::A,
        pips_remaining: 4,
        last_pip_roll: 4,
        seed,
        roll_index: 0,
        winner: None,
        draw: false,
        terrain: Vec::new(),
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

fn unit_by_id<'a>(handle: &'a FastGameHandle, unit_id: &str) -> &'a Unit {
    handle
        .state
        .units
        .iter()
        .find(|unit| unit.id == unit_id)
        .expect("unit should exist")
}

fn charge_action_index(handle: &FastGameHandle, unit_id: &str, target_id: &str) -> usize {
    handle
        .legal_actions()
        .iter()
        .position(|action| {
            matches!(
                action,
                LegalAction::Charge {
                    unit_id: action_unit_id,
                    target_id: action_target_id,
                    ..
                } if action_unit_id == unit_id && action_target_id == target_id
            )
        })
        .expect("charge should be legal")
}

fn shoot_action(handle: &FastGameHandle, unit_id: &str, target_id: &str) -> Action {
    handle
        .legal_actions()
        .into_iter()
        .find_map(|action| match action {
            LegalAction::Shoot {
                unit_id: action_unit_id,
                target_id: action_target_id,
                ..
            } if action_unit_id == unit_id && action_target_id == target_id => {
                Some(Action::Shoot {
                    unit_id: action_unit_id,
                    target_id: action_target_id,
                })
            }
            _ => None,
        })
        .expect("shoot should be legal")
}

fn charge_action(handle: &FastGameHandle, unit_id: &str, target_id: &str) -> Action {
    handle
        .legal_actions()
        .into_iter()
        .find_map(|action| match action {
            LegalAction::Charge {
                unit_id: action_unit_id,
                target_id: action_target_id,
                destination,
                path,
                facing,
                ..
            } if action_unit_id == unit_id && action_target_id == target_id => {
                Some(Action::Charge {
                    unit_id: action_unit_id,
                    target_id: action_target_id,
                    destination,
                    path,
                    facing,
                })
            }
            _ => None,
        })
        .expect("charge should be legal")
}

fn move_action_to(handle: &FastGameHandle, unit_id: &str, destination: Coord) -> Action {
    handle
        .legal_actions()
        .into_iter()
        .find_map(|action| match action {
            LegalAction::Move {
                unit_id: action_unit_id,
                destination: action_destination,
                path,
                facing,
                ..
            } if action_unit_id == unit_id && action_destination == destination => {
                Some(Action::Move {
                    unit_id: action_unit_id,
                    destination: action_destination,
                    path,
                    facing,
                })
            }
            _ => None,
        })
        .expect("move should be legal")
}

fn army_morale_loss(state: &GameState, army: ArmyId) -> i32 {
    state
        .armies
        .iter()
        .find(|status| status.id == army)
        .map(|status| status.morale_loss)
        .unwrap_or(0)
}

#[test]
fn frontage_close_combat_uses_current_player_as_attacker() {
    let units = vec![
        test_unit(
            "A-PK",
            ArmyId::A,
            UnitKind::Pike,
            Coord { x: 2, y: 3 },
            Direction::N,
        ),
        test_unit(
            "B-PK",
            ArmyId::B,
            UnitKind::Pike,
            Coord { x: 2, y: 2 },
            Direction::S,
        ),
    ];
    let mut handle = FastGameHandle {
        state: test_state(units, ArmyId::B, 1),
        history: Vec::new(),
    };

    handle
        .apply_action(Action::EndBound)
        .expect("combat should resolve");

    assert!(handle
        .state
        .log
        .iter()
        .any(|entry| entry.message.contains("B B-PK engaged A A-PK")));
}

#[test]
fn ordinary_frontage_close_combat_is_role_neutral() {
    let units = vec![
        test_unit(
            "A-PK",
            ArmyId::A,
            UnitKind::Pike,
            Coord { x: 2, y: 3 },
            Direction::N,
        ),
        test_unit(
            "B-PK",
            ArmyId::B,
            UnitKind::Pike,
            Coord { x: 2, y: 2 },
            Direction::S,
        ),
    ];
    let mut handle = FastGameHandle {
        state: test_state(units, ArmyId::B, 1),
        history: Vec::new(),
    };

    handle
        .apply_action(Action::EndBound)
        .expect("combat should resolve");

    let resolution = &handle.state.recent_resolutions[0];
    assert_eq!(resolution.attacker_id, "B-PK");
    assert_eq!(resolution.defender_id, "A-PK");
    assert_eq!(resolution.attacker_score, 8);
    assert_eq!(resolution.defender_score, 8);
    assert!(resolution
        .attacker_notes
        .iter()
        .any(|note| note == "ordered pike frontal defense +4"));
    assert!(resolution
        .defender_notes
        .iter()
        .any(|note| note == "ordered pike frontal defense +4"));
    assert!(!resolution
        .attacker_notes
        .iter()
        .any(|note| note == "ordered pike frontal attack +3"));
}

#[test]
fn ordinary_frontage_matching_suffix_units_roll_separate_dice() {
    let units = vec![
        test_unit(
            "A-CV1",
            ArmyId::A,
            UnitKind::Cavalry,
            Coord { x: 2, y: 3 },
            Direction::N,
        ),
        test_unit(
            "B-CV1",
            ArmyId::B,
            UnitKind::Cavalry,
            Coord { x: 2, y: 2 },
            Direction::S,
        ),
    ];
    let mut handle = FastGameHandle {
        state: test_state(units, ArmyId::A, 2),
        history: Vec::new(),
    };

    handle
        .apply_action(Action::EndBound)
        .expect("combat should resolve");

    let resolution = &handle.state.recent_resolutions[0];
    assert_eq!(resolution.attacker_id, "A-CV1");
    assert_eq!(resolution.defender_id, "B-CV1");
    assert_ne!(resolution.attacker_roll, resolution.defender_roll);
}

#[test]
fn ordered_pike_frontal_clash_uses_attritional_margin_bands() {
    let units = vec![
        test_unit(
            "A-PK",
            ArmyId::A,
            UnitKind::Pike,
            Coord { x: 2, y: 3 },
            Direction::N,
        ),
        test_unit(
            "B-PK",
            ArmyId::B,
            UnitKind::Pike,
            Coord { x: 2, y: 2 },
            Direction::S,
        ),
    ];
    let state = test_state(units, ArmyId::A, 1);
    let winner = state.units[0].clone();
    let loser = state.units[1].clone();

    assert_eq!(
        combat::resolve_close_combat_outcome(&state, &winner, &loser, "front", 2),
        "no_effect"
    );
    assert_eq!(
        combat::resolve_close_combat_outcome(&state, &winner, &loser, "front", 4),
        "disorder"
    );
    assert_eq!(
        combat::resolve_close_combat_outcome(&state, &winner, &loser, "front", 6),
        "recoil"
    );
    assert_eq!(
        combat::resolve_close_combat_outcome(&state, &winner, &loser, "front", 7),
        "destroy"
    );
}

#[test]
fn frontal_heavy_combat_small_margin_has_no_effect() {
    let units = vec![
        test_unit(
            "A-BD",
            ArmyId::A,
            UnitKind::Blade,
            Coord { x: 2, y: 3 },
            Direction::N,
        ),
        test_unit(
            "B-SP",
            ArmyId::B,
            UnitKind::Spear,
            Coord { x: 2, y: 2 },
            Direction::S,
        ),
    ];
    let state = test_state(units, ArmyId::A, 1);
    let winner = state.units[0].clone();
    let loser = state.units[1].clone();

    assert_eq!(
        combat::resolve_close_combat_outcome(&state, &winner, &loser, "front", 1),
        "no_effect"
    );
    assert_eq!(
        combat::resolve_close_combat_outcome(&state, &winner, &loser, "front", 2),
        "no_effect"
    );
    assert_eq!(
        combat::resolve_close_combat_outcome(&state, &winner, &loser, "side", 1),
        "recoil"
    );
    assert_ne!(
        combat::resolve_close_combat_outcome(&state, &winner, &loser, "side", 2),
        "no_effect"
    );
}

#[test]
fn inferior_front_loser_still_disorders_on_softened_outcomes() {
    let mut inferior_spear = test_unit(
        "B-SP",
        ArmyId::B,
        UnitKind::Spear,
        Coord { x: 2, y: 2 },
        Direction::S,
    );
    inferior_spear.quality = UnitQuality::Inferior;
    let units = vec![
        test_unit(
            "A-BD",
            ArmyId::A,
            UnitKind::Blade,
            Coord { x: 2, y: 3 },
            Direction::N,
        ),
        inferior_spear,
    ];
    let state = test_state(units, ArmyId::A, 1);
    let winner = state.units[0].clone();
    let loser = state.units[1].clone();

    assert_eq!(
        combat::resolve_close_combat_outcome(&state, &winner, &loser, "front", 1),
        "disorder"
    );
    assert_eq!(
        combat::resolve_close_combat_outcome(&state, &winner, &loser, "front", 2),
        "disorder"
    );

    let mut inferior_pike = test_unit(
        "B-PK",
        ArmyId::B,
        UnitKind::Pike,
        Coord { x: 2, y: 2 },
        Direction::S,
    );
    inferior_pike.quality = UnitQuality::Inferior;
    let pike_units = vec![
        test_unit(
            "A-PK",
            ArmyId::A,
            UnitKind::Pike,
            Coord { x: 2, y: 3 },
            Direction::N,
        ),
        inferior_pike,
    ];
    let pike_state = test_state(pike_units, ArmyId::A, 1);
    let pike_winner = pike_state.units[0].clone();
    let pike_loser = pike_state.units[1].clone();

    assert_eq!(
        combat::resolve_close_combat_outcome(&pike_state, &pike_winner, &pike_loser, "front", 2,),
        "disorder"
    );
}

#[test]
fn successful_charge_sets_charging_and_consumes_it_at_end_bound() {
    let units = vec![
        test_unit(
            "A-CV",
            ArmyId::A,
            UnitKind::Cavalry,
            Coord { x: 2, y: 4 },
            Direction::N,
        ),
        test_unit(
            "B-SP",
            ArmyId::B,
            UnitKind::Spear,
            Coord { x: 2, y: 2 },
            Direction::S,
        ),
    ];
    let mut handle = FastGameHandle {
        state: test_state(units, ArmyId::A, 1),
        history: Vec::new(),
    };

    let charge_index = charge_action_index(&handle, "A-CV", "B-SP");
    handle
        .apply_legal_action_index(charge_index)
        .expect("charge should apply");

    assert!(unit_by_id(&handle, "A-CV").charging);

    handle
        .apply_action(Action::EndBound)
        .expect("end bound should resolve");

    assert!(!unit_by_id(&handle, "A-CV").charging);
    assert!(handle.state.recent_resolutions[0]
        .attacker_notes
        .iter()
        .any(|note| note == "charge impact +3"));
}

#[test]
fn evaded_charge_does_not_set_charging() {
    let units = vec![
        test_unit(
            "A-CV",
            ArmyId::A,
            UnitKind::Cavalry,
            Coord { x: 2, y: 4 },
            Direction::N,
        ),
        test_unit(
            "B-PS",
            ArmyId::B,
            UnitKind::Psiloi,
            Coord { x: 2, y: 2 },
            Direction::S,
        ),
    ];
    let mut handle = FastGameHandle {
        state: test_state(units, ArmyId::A, 1),
        history: Vec::new(),
    };

    let charge_index = charge_action_index(&handle, "A-CV", "B-PS");
    handle
        .apply_legal_action_index(charge_index)
        .expect("charge should apply");

    assert!(!unit_by_id(&handle, "A-CV").charging);
    assert_eq!(unit_by_id(&handle, "B-PS").position, Coord { x: 2, y: 0 });
}

#[test]
fn cavalry_charge_impact_adds_three_to_close_combat_score() {
    let mut cavalry = test_unit(
        "A-CV",
        ArmyId::A,
        UnitKind::Cavalry,
        Coord { x: 2, y: 3 },
        Direction::N,
    );
    cavalry.charging = true;
    let units = vec![
        cavalry,
        test_unit(
            "B-PS",
            ArmyId::B,
            UnitKind::Psiloi,
            Coord { x: 2, y: 2 },
            Direction::S,
        ),
    ];
    let mut handle = FastGameHandle {
        state: test_state(units, ArmyId::A, 1),
        history: Vec::new(),
    };

    handle
        .apply_action(Action::EndBound)
        .expect("end bound should resolve");

    let resolution = &handle.state.recent_resolutions[0];
    assert_eq!(resolution.attacker_score, 6);
    assert!(resolution
        .attacker_notes
        .iter()
        .any(|note| note == "charge impact +3"));
    assert!(!unit_by_id(&handle, "A-CV").charging);
}

#[test]
fn pike_charge_bonus_only_applies_from_the_front() {
    let mut front_pike = test_unit(
        "A-PK",
        ArmyId::A,
        UnitKind::Pike,
        Coord { x: 2, y: 3 },
        Direction::N,
    );
    front_pike.charging = true;
    let mut front_handle = FastGameHandle {
        state: test_state(
            vec![
                front_pike,
                test_unit(
                    "B-CV",
                    ArmyId::B,
                    UnitKind::Cavalry,
                    Coord { x: 2, y: 2 },
                    Direction::S,
                ),
            ],
            ArmyId::A,
            1,
        ),
        history: Vec::new(),
    };

    front_handle
        .apply_action(Action::EndBound)
        .expect("front combat should resolve");

    let front_resolution = &front_handle.state.recent_resolutions[0];
    assert_eq!(front_resolution.attacker_score, 8);
    assert!(front_resolution
        .attacker_notes
        .iter()
        .any(|note| note == "ordered pike frontal attack +3"));

    let mut side_pike = test_unit(
        "A-PK",
        ArmyId::A,
        UnitKind::Pike,
        Coord { x: 1, y: 2 },
        Direction::E,
    );
    side_pike.charging = true;
    let mut side_handle = FastGameHandle {
        state: test_state(
            vec![
                side_pike,
                test_unit(
                    "B-CV",
                    ArmyId::B,
                    UnitKind::Cavalry,
                    Coord { x: 2, y: 2 },
                    Direction::N,
                ),
            ],
            ArmyId::A,
            1,
        ),
        history: Vec::new(),
    };

    side_handle
        .apply_action(Action::EndBound)
        .expect("side combat should resolve");

    let side_resolution = &side_handle.state.recent_resolutions[0];
    assert_eq!(side_resolution.attacker_score, 9);
    assert!(side_resolution
        .attacker_notes
        .iter()
        .any(|note| note == "ordered pike frontal attack +3"));
}

#[test]
fn pursuit_into_fresh_contact_does_not_refresh_charge_bonus() {
    let mut blade = test_unit(
        "A-BD",
        ArmyId::A,
        UnitKind::Blade,
        Coord { x: 2, y: 2 },
        Direction::N,
    );
    blade.charging = true;
    let units = vec![
        blade,
        test_unit(
            "B-CV",
            ArmyId::B,
            UnitKind::Cavalry,
            Coord { x: 2, y: 1 },
            Direction::S,
        ),
        test_unit(
            "B-BW",
            ArmyId::B,
            UnitKind::Bow,
            Coord { x: 3, y: 1 },
            Direction::W,
        ),
    ];
    let mut handle = FastGameHandle {
        state: test_state(units, ArmyId::A, 1),
        history: Vec::new(),
    };

    handle
        .apply_action(Action::EndBound)
        .expect("initial combat should resolve");

    assert!(!unit_by_id(&handle, "A-BD").charging);
    assert!(handle.state.recent_resolutions[0]
        .attacker_notes
        .iter()
        .any(|note| note == "charge impact +1"));
}

#[test]
fn pike_in_open_starts_as_ordered_pike() {
    let handle = EngineCore::new()
        .new_game("classic_battle", 7)
        .expect("game should build");
    let pike = unit_by_id(&handle, "A-PK1");
    assert_eq!(pike.formation_state, FormationState::OrderedPike);
    assert!(!pike.disordered);
}

#[test]
fn pike_entering_hill_becomes_disordered_pike() {
    let units = vec![
        test_unit(
            "A-PK",
            ArmyId::A,
            UnitKind::Pike,
            Coord { x: 2, y: 4 },
            Direction::N,
        ),
        test_unit(
            "B-SP",
            ArmyId::B,
            UnitKind::Spear,
            Coord { x: 7, y: 7 },
            Direction::S,
        ),
    ];
    let mut state = test_state(units, ArmyId::A, 1);
    state.terrain = vec![TerrainTile {
        position: Coord { x: 2, y: 3 },
        terrain: TerrainType::Hill,
    }];
    let mut handle = FastGameHandle {
        state,
        history: Vec::new(),
    };
    let move_index = handle
        .legal_actions()
        .iter()
        .position(|action| {
            matches!(action, LegalAction::Move { unit_id, destination, .. }
                if unit_id == "A-PK" && *destination == (Coord { x: 2, y: 3 }))
        })
        .expect("hill move should be legal");

    handle
        .apply_legal_action_index(move_index)
        .expect("move should apply");

    assert_eq!(
        unit_by_id(&handle, "A-PK").formation_state,
        FormationState::DisorderedPike
    );
    assert!(unit_by_id(&handle, "A-PK").disordered);
}

#[test]
fn disordered_pike_cannot_group_charge_or_march_move() {
    let mut pike_a = test_unit(
        "A-PK1",
        ArmyId::A,
        UnitKind::Pike,
        Coord { x: 2, y: 4 },
        Direction::N,
    );
    let mut pike_b = test_unit(
        "A-PK2",
        ArmyId::A,
        UnitKind::Pike,
        Coord { x: 3, y: 4 },
        Direction::N,
    );
    for pike in [&mut pike_a, &mut pike_b] {
        pike.formation_state = FormationState::DisorderedPike;
        pike.disordered = true;
    }
    let units = vec![
        pike_a,
        pike_b,
        test_unit(
            "B-SP1",
            ArmyId::B,
            UnitKind::Spear,
            Coord { x: 2, y: 2 },
            Direction::S,
        ),
        test_unit(
            "B-SP2",
            ArmyId::B,
            UnitKind::Spear,
            Coord { x: 3, y: 2 },
            Direction::S,
        ),
    ];
    let handle = FastGameHandle {
        state: test_state(units, ArmyId::A, 1),
        history: Vec::new(),
    };

    let legal = handle.legal_actions();
    assert!(!legal.iter().any(
        |action| matches!(action, LegalAction::MarchMove { unit_id, .. } if unit_id == "A-PK1")
    ));
    assert!(!legal.iter().any(|action| matches!(action, LegalAction::GroupCharge { unit_ids, .. } if unit_ids.contains(&"A-PK1".to_string()))));
}

#[test]
fn unit_in_enemy_contact_cannot_take_ordinary_orders() {
    let units = vec![
        test_unit(
            "A-PK",
            ArmyId::A,
            UnitKind::Pike,
            Coord { x: 2, y: 3 },
            Direction::N,
        ),
        test_unit(
            "B-SP",
            ArmyId::B,
            UnitKind::Spear,
            Coord { x: 2, y: 2 },
            Direction::S,
        ),
    ];
    let handle = FastGameHandle {
        state: test_state(units, ArmyId::A, 1),
        history: Vec::new(),
    };

    let legal = handle.legal_actions();

    assert!(!legal
        .iter()
        .any(|action| matches!(action, LegalAction::Move { unit_id, .. }
            | LegalAction::MarchMove { unit_id, .. }
            | LegalAction::Charge { unit_id, .. }
            | LegalAction::Rotate { unit_id, .. }
            | LegalAction::Shoot { unit_id, .. }
            | LegalAction::Rally { unit_id, .. }
            | LegalAction::ReformPike { unit_id, .. }
            if unit_id == "A-PK")));
    assert!(!legal.iter().any(
        |action| matches!(action, LegalAction::GroupMove { unit_ids, .. }
            | LegalAction::GroupMarchMove { unit_ids, .. }
            | LegalAction::GroupCharge { unit_ids, .. }
            if unit_ids.contains(&"A-PK".to_string()))
    ));
}

#[test]
fn no_effect_close_combat_leaves_units_in_combat() {
    let units = vec![
        test_unit(
            "A-PK",
            ArmyId::A,
            UnitKind::Pike,
            Coord { x: 2, y: 3 },
            Direction::N,
        ),
        test_unit(
            "B-PK",
            ArmyId::B,
            UnitKind::Pike,
            Coord { x: 2, y: 2 },
            Direction::S,
        ),
    ];
    let mut handle = FastGameHandle {
        state: test_state(units, ArmyId::A, 1),
        history: Vec::new(),
    };

    handle
        .apply_action(Action::EndBound)
        .expect("close combat should resolve");

    assert_eq!(unit_by_id(&handle, "A-PK").position, Coord { x: 2, y: 3 });
    assert_eq!(unit_by_id(&handle, "B-PK").position, Coord { x: 2, y: 2 });
    assert!(handle.state.log.iter().any(|entry| entry
        .message
        .contains("remain in combat while still in contact")));

    let legal = handle.legal_actions();
    assert!(!legal
        .iter()
        .any(|action| matches!(action, LegalAction::Move { unit_id, .. }
            | LegalAction::MarchMove { unit_id, .. }
            | LegalAction::Charge { unit_id, .. }
            | LegalAction::Rotate { unit_id, .. }
            if unit_id == "B-PK")));
}

#[test]
fn light_unit_can_break_off_from_enemy_contact_and_becomes_disordered() {
    let units = vec![
        test_unit(
            "A-PS",
            ArmyId::A,
            UnitKind::Psiloi,
            Coord { x: 2, y: 3 },
            Direction::N,
        ),
        test_unit(
            "B-SP",
            ArmyId::B,
            UnitKind::Spear,
            Coord { x: 2, y: 2 },
            Direction::S,
        ),
    ];
    let mut handle = FastGameHandle {
        state: test_state(units, ArmyId::A, 1),
        history: Vec::new(),
    };

    let legal = handle.legal_actions();
    let break_off_index = legal
        .iter()
        .position(|action| matches!(action, LegalAction::Move { unit_id, .. } if unit_id == "A-PS"))
        .expect("fresh psiloi should be able to break off from contact");

    handle
        .apply_legal_action_index(break_off_index)
        .expect("break-off move should apply");

    assert!(unit_by_id(&handle, "A-PS").disordered);
    assert_ne!(unit_by_id(&handle, "A-PS").position, Coord { x: 2, y: 3 });
    assert!(handle
        .state
        .log
        .iter()
        .any(|entry| entry.message.contains("broke off from close combat")));
}

#[test]
fn group_move_and_march_cost_only_base_pip_in_clear_going() {
    let units = vec![
        test_unit(
            "A-PK1",
            ArmyId::A,
            UnitKind::Pike,
            Coord { x: 2, y: 5 },
            Direction::N,
        ),
        test_unit(
            "A-PK2",
            ArmyId::A,
            UnitKind::Pike,
            Coord { x: 3, y: 5 },
            Direction::N,
        ),
        test_unit(
            "A-PK3",
            ArmyId::A,
            UnitKind::Pike,
            Coord { x: 4, y: 5 },
            Direction::N,
        ),
        test_unit(
            "B-SP",
            ArmyId::B,
            UnitKind::Spear,
            Coord { x: 7, y: 0 },
            Direction::S,
        ),
    ];
    let mut handle = FastGameHandle {
        state: test_state(units, ArmyId::A, 1),
        history: Vec::new(),
    };
    handle.state.pips_remaining = 1;

    let legal = handle.legal_actions();
    let group_move_cost = legal
        .iter()
        .find_map(|action| match action {
            LegalAction::GroupMove { pip_cost, .. } => Some(*pip_cost),
            _ => None,
        })
        .expect("group move should be legal with 1 PIP");
    let group_march_cost = legal
        .iter()
        .find_map(|action| match action {
            LegalAction::GroupMarchMove { pip_cost, .. } => Some(*pip_cost),
            _ => None,
        })
        .expect("group march should be legal with 1 PIP");

    assert_eq!(group_move_cost, 1);
    assert_eq!(group_march_cost, 1);
}

#[test]
fn group_orders_are_sorted_before_single_orders_and_end_bound() {
    let units = vec![
        test_unit(
            "A-PK1",
            ArmyId::A,
            UnitKind::Pike,
            Coord { x: 2, y: 5 },
            Direction::N,
        ),
        test_unit(
            "A-PK2",
            ArmyId::A,
            UnitKind::Pike,
            Coord { x: 3, y: 5 },
            Direction::N,
        ),
        test_unit(
            "A-PK3",
            ArmyId::A,
            UnitKind::Pike,
            Coord { x: 4, y: 5 },
            Direction::N,
        ),
        test_unit(
            "B-SP",
            ArmyId::B,
            UnitKind::Spear,
            Coord { x: 7, y: 0 },
            Direction::S,
        ),
    ];
    let handle = FastGameHandle {
        state: test_state(units, ArmyId::A, 1),
        history: Vec::new(),
    };

    let legal = handle.legal_actions();
    assert!(matches!(
        legal.first(),
        Some(LegalAction::GroupMarchMove { .. } | LegalAction::GroupMove { .. })
    ));
    let first_single_move = legal
        .iter()
        .position(|action| {
            matches!(
                action,
                LegalAction::Move { .. } | LegalAction::MarchMove { .. }
            )
        })
        .expect("single movement should also be legal");
    let first_end_bound = legal
        .iter()
        .position(|action| matches!(action, LegalAction::EndBound))
        .expect("end_bound should be legal");
    assert!(first_single_move > 0);
    assert!(first_end_bound > first_single_move);
}

#[test]
fn disordered_pike_can_reform_when_in_command_safe_and_open() {
    let mut pike = test_unit(
        "A-PK",
        ArmyId::A,
        UnitKind::Pike,
        Coord { x: 2, y: 4 },
        Direction::N,
    );
    pike.formation_state = FormationState::DisorderedPike;
    pike.disordered = true;
    let mut handle = FastGameHandle {
        state: test_state(
            vec![
                pike,
                test_unit(
                    "B-SP",
                    ArmyId::B,
                    UnitKind::Spear,
                    Coord { x: 7, y: 7 },
                    Direction::S,
                ),
            ],
            ArmyId::A,
            1,
        ),
        history: Vec::new(),
    };
    let reform_index = handle
        .legal_actions()
        .iter()
        .position(|action| matches!(action, LegalAction::ReformPike { unit_id, pip_cost } if unit_id == "A-PK" && *pip_cost == 1))
        .expect("reform should be legal");

    handle
        .apply_legal_action_index(reform_index)
        .expect("reform should apply");

    assert_eq!(
        unit_by_id(&handle, "A-PK").formation_state,
        FormationState::OrderedPike
    );
    assert!(!unit_by_id(&handle, "A-PK").disordered);
}

#[test]
fn ordered_pike_gets_frontal_defensive_bonus() {
    let units = vec![
        test_unit(
            "A-SP",
            ArmyId::A,
            UnitKind::Spear,
            Coord { x: 2, y: 3 },
            Direction::N,
        ),
        test_unit(
            "B-PK",
            ArmyId::B,
            UnitKind::Pike,
            Coord { x: 2, y: 2 },
            Direction::S,
        ),
    ];
    let mut handle = FastGameHandle {
        state: test_state(units, ArmyId::A, 1),
        history: Vec::new(),
    };

    handle
        .apply_action(Action::EndBound)
        .expect("combat should resolve");

    let resolution = &handle.state.recent_resolutions[0];
    assert_eq!(resolution.defender_score, 8);
    assert!(resolution
        .defender_notes
        .iter()
        .any(|note| note == "ordered pike frontal defense +4"));
}

#[test]
fn cavalry_charging_ordered_pike_front_gets_no_shock() {
    let mut cavalry = test_unit(
        "A-CV",
        ArmyId::A,
        UnitKind::Cavalry,
        Coord { x: 2, y: 3 },
        Direction::N,
    );
    cavalry.charging = true;
    let units = vec![
        cavalry,
        test_unit(
            "B-PK",
            ArmyId::B,
            UnitKind::Pike,
            Coord { x: 2, y: 2 },
            Direction::S,
        ),
    ];
    let mut handle = FastGameHandle {
        state: test_state(units, ArmyId::A, 1),
        history: Vec::new(),
    };

    handle
        .apply_action(Action::EndBound)
        .expect("combat should resolve");

    let resolution = &handle.state.recent_resolutions[0];
    assert_eq!(resolution.attacker_score, 3);
    assert!(resolution
        .attacker_notes
        .iter()
        .any(|note| note == "charge shock canceled by ordered pike"));
}

#[test]
fn pike_contacted_from_flank_becomes_disordered_pike() {
    let units = vec![
        test_unit(
            "A-PK",
            ArmyId::A,
            UnitKind::Pike,
            Coord { x: 2, y: 2 },
            Direction::N,
        ),
        test_unit(
            "B-CV",
            ArmyId::B,
            UnitKind::Cavalry,
            Coord { x: 0, y: 2 },
            Direction::E,
        ),
    ];
    let mut handle = FastGameHandle {
        state: test_state(units, ArmyId::B, 1),
        history: Vec::new(),
    };

    let charge_index = charge_action_index(&handle, "B-CV", "A-PK");
    handle
        .apply_legal_action_index(charge_index)
        .expect("flank charge should apply");

    assert_eq!(
        unit_by_id(&handle, "A-PK").formation_state,
        FormationState::DisorderedPike
    );
}

#[test]
fn disorder_recovery_depends_on_unit_class() {
    let mut light = test_unit(
        "B-PS",
        ArmyId::B,
        UnitKind::Psiloi,
        Coord { x: 0, y: 0 },
        Direction::S,
    );
    let mut formed = test_unit(
        "B-SP",
        ArmyId::B,
        UnitKind::Spear,
        Coord { x: 2, y: 0 },
        Direction::S,
    );
    let mut leader = test_unit(
        "B-GEN",
        ArmyId::B,
        UnitKind::Cavalry,
        Coord { x: 4, y: 0 },
        Direction::S,
    );
    leader.leader = true;
    leader.army_general = true;
    let mut cavalry_in = test_unit(
        "B-CV-IN",
        ArmyId::B,
        UnitKind::Cavalry,
        Coord { x: 4, y: 1 },
        Direction::S,
    );
    let mut cavalry_out = test_unit(
        "B-CV-OUT",
        ArmyId::B,
        UnitKind::Cavalry,
        Coord { x: 7, y: 7 },
        Direction::S,
    );
    for unit in [&mut light, &mut formed, &mut cavalry_in, &mut cavalry_out] {
        unit.disordered = true;
    }
    let units = vec![
        test_unit(
            "A-SP",
            ArmyId::A,
            UnitKind::Spear,
            Coord { x: 0, y: 7 },
            Direction::N,
        ),
        light,
        formed,
        leader,
        cavalry_in,
        cavalry_out,
    ];
    let mut handle = FastGameHandle {
        state: test_state(units, ArmyId::A, 1),
        history: Vec::new(),
    };

    handle
        .apply_action(Action::EndBound)
        .expect("bound should end");

    assert!(!unit_by_id(&handle, "B-PS").disordered);
    assert!(unit_by_id(&handle, "B-SP").disordered);
    assert!(!unit_by_id(&handle, "B-CV-IN").disordered);
    assert!(unit_by_id(&handle, "B-CV-OUT").disordered);
}

#[test]
fn elephant_hit_by_missile_disorder_can_panic() {
    let mut elephant = test_unit(
        "A-EL",
        ArmyId::A,
        UnitKind::Elephants,
        Coord { x: 2, y: 2 },
        Direction::N,
    );
    elephant.quality = UnitQuality::Inferior;
    elephant.disordered = true;
    elephant.in_command = false;
    let units = vec![
        elephant,
        test_unit(
            "B-BW",
            ArmyId::B,
            UnitKind::Bow,
            Coord { x: 2, y: 4 },
            Direction::N,
        ),
    ];
    let mut handle = FastGameHandle {
        state: test_state(units, ArmyId::A, 1),
        history: Vec::new(),
    };

    let source = unit_by_id(&handle, "B-BW").clone();
    combat::resolve_panic_test(
        &mut handle.state,
        "A-EL",
        combat::PanicTrigger::MissileDisorder,
        Some(source),
    );

    assert_eq!(
        unit_by_id(&handle, "A-EL").formation_state,
        FormationState::Panic
    );
}

#[test]
fn chariot_shot_by_light_troops_is_more_likely_to_panic() {
    let chariot = test_unit(
        "A-CH",
        ArmyId::A,
        UnitKind::ScythedChariots,
        Coord { x: 2, y: 2 },
        Direction::N,
    );
    let source = test_unit(
        "B-PS",
        ArmyId::B,
        UnitKind::Psiloi,
        Coord { x: 2, y: 4 },
        Direction::N,
    );
    let mut missile_handle = FastGameHandle {
        state: test_state(vec![chariot.clone(), source.clone()], ArmyId::A, 1),
        history: Vec::new(),
    };
    let mut light_handle = missile_handle.clone();

    let normal = combat::resolve_panic_test(
        &mut missile_handle.state,
        "A-CH",
        combat::PanicTrigger::MissileDisorder,
        Some(source.clone()),
    );
    let light = combat::resolve_panic_test(
        &mut light_handle.state,
        "A-CH",
        combat::PanicTrigger::ShotByLightTroops,
        Some(source),
    );

    assert!(!normal);
    assert!(light);
}

#[test]
fn shooting_queues_until_end_bound() {
    let units = vec![
        test_unit(
            "A-BW",
            ArmyId::A,
            UnitKind::Bow,
            Coord { x: 2, y: 4 },
            Direction::N,
        ),
        test_unit(
            "B-PS",
            ArmyId::B,
            UnitKind::Psiloi,
            Coord { x: 2, y: 2 },
            Direction::S,
        ),
    ];
    let mut handle = FastGameHandle {
        state: test_state(units, ArmyId::A, 1),
        history: Vec::new(),
    };
    let shoot_action = handle
        .legal_actions()
        .iter()
        .find_map(|action| match action {
            LegalAction::Shoot {
                unit_id, target_id, ..
            } if unit_id == "A-BW" && target_id == "B-PS" => Some(Action::Shoot {
                unit_id: unit_id.clone(),
                target_id: target_id.clone(),
            }),
            _ => None,
        })
        .expect("shot should be legal");

    handle
        .apply_action(shoot_action)
        .expect("shot should queue");

    assert_eq!(handle.state.pending_shots.len(), 1);
    assert!(handle.state.recent_resolutions.is_empty());
    assert!(unit_by_id(&handle, "B-PS").formation_state != FormationState::Rout);

    handle
        .apply_action(Action::EndBound)
        .expect("end_bound should resolve queued shot");

    assert!(handle.state.pending_shots.is_empty());
    assert!(handle
        .state
        .recent_resolutions
        .iter()
        .any(
            |resolution| resolution.kind == engine_core::CombatKind::Missile
                && resolution.attacker_id == "A-BW"
                && resolution.defender_id == "B-PS"
        ));
}

#[test]
fn queued_shooting_can_remove_a_target_before_a_planned_charge_fights() {
    let units = vec![
        test_unit(
            "A-PS",
            ArmyId::A,
            UnitKind::Psiloi,
            Coord { x: 0, y: 3 },
            Direction::E,
        ),
        test_unit(
            "A-CV",
            ArmyId::A,
            UnitKind::Cavalry,
            Coord { x: 2, y: 5 },
            Direction::N,
        ),
        test_unit(
            "B-HD",
            ArmyId::B,
            UnitKind::Horde,
            Coord { x: 2, y: 3 },
            Direction::S,
        ),
    ];
    let mut handle = FastGameHandle {
        state: test_state(units, ArmyId::A, 2),
        history: Vec::new(),
    };
    let shoot_action = handle
        .legal_actions()
        .iter()
        .find_map(|action| match action {
            LegalAction::Shoot {
                unit_id, target_id, ..
            } if unit_id == "A-PS" && target_id == "B-HD" => Some(Action::Shoot {
                unit_id: unit_id.clone(),
                target_id: target_id.clone(),
            }),
            _ => None,
        })
        .expect("psiloi shot should be legal");

    handle
        .apply_action(shoot_action)
        .expect("shot should queue");

    let charge_action = handle
        .legal_actions()
        .iter()
        .find_map(|action| match action {
            LegalAction::Charge {
                unit_id,
                target_id,
                destination,
                path,
                facing,
                ..
            } if unit_id == "A-CV" && target_id == "B-HD" => Some(Action::Charge {
                unit_id: unit_id.clone(),
                target_id: target_id.clone(),
                destination: destination.clone(),
                path: path.clone(),
                facing: facing.clone(),
            }),
            _ => None,
        })
        .expect("charge should still be legal before queued shooting resolves");

    handle
        .apply_action(charge_action)
        .expect("charge should be applied before end_bound");
    assert!(unit_by_id(&handle, "A-CV").charging);
    assert!(!unit_by_id(&handle, "B-HD").eliminated);

    handle
        .apply_action(Action::EndBound)
        .expect("end_bound should resolve shooting before close combat");

    assert!(unit_by_id(&handle, "B-HD").eliminated);
    assert!(!unit_by_id(&handle, "A-CV").charging);
    assert!(handle.state.recent_resolutions.iter().any(|resolution| {
        resolution.kind == engine_core::CombatKind::Missile
            && resolution.attacker_id == "A-PS"
            && resolution.defender_id == "B-HD"
            && resolution.outcome == "destroy"
    }));
    assert!(!handle
        .state
        .recent_resolutions
        .iter()
        .any(|resolution| resolution.kind == engine_core::CombatKind::CloseCombat));
}

#[test]
fn queued_shooting_recoils_a_target_before_close_combat_pairs_are_built() {
    let units = vec![
        test_unit(
            "A-PS",
            ArmyId::A,
            UnitKind::Psiloi,
            Coord { x: 0, y: 3 },
            Direction::E,
        ),
        test_unit(
            "A-CV",
            ArmyId::A,
            UnitKind::Cavalry,
            Coord { x: 2, y: 5 },
            Direction::N,
        ),
        test_unit(
            "B-SP",
            ArmyId::B,
            UnitKind::Spear,
            Coord { x: 2, y: 3 },
            Direction::S,
        ),
    ];
    let mut handle = FastGameHandle {
        state: test_state(units, ArmyId::A, 1),
        history: Vec::new(),
    };

    handle
        .apply_action(shoot_action(&handle, "A-PS", "B-SP"))
        .expect("shot should queue");
    handle
        .apply_action(charge_action(&handle, "A-CV", "B-SP"))
        .expect("charge should apply before shooting resolves");

    handle
        .apply_action(Action::EndBound)
        .expect("end_bound should resolve queued recoil before combat pairing");

    assert_eq!(unit_by_id(&handle, "B-SP").position, Coord { x: 3, y: 3 });
    assert!(!unit_by_id(&handle, "A-CV").charging);
    assert!(handle.state.recent_resolutions.iter().any(|resolution| {
        resolution.kind == engine_core::CombatKind::Missile
            && resolution.attacker_id == "A-PS"
            && resolution.defender_id == "B-SP"
            && resolution.outcome == "recoil"
    }));
    assert!(!handle
        .state
        .recent_resolutions
        .iter()
        .any(|resolution| resolution.kind == engine_core::CombatKind::CloseCombat));
}

#[test]
fn queued_shooting_revalidates_line_of_sight_after_later_movement() {
    let units = vec![
        test_unit(
            "A-BW",
            ArmyId::A,
            UnitKind::Bow,
            Coord { x: 0, y: 3 },
            Direction::E,
        ),
        test_unit(
            "A-AX",
            ArmyId::A,
            UnitKind::Auxilia,
            Coord { x: 1, y: 5 },
            Direction::N,
        ),
        test_unit(
            "B-SP",
            ArmyId::B,
            UnitKind::Spear,
            Coord { x: 3, y: 3 },
            Direction::S,
        ),
    ];
    let mut handle = FastGameHandle {
        state: test_state(units, ArmyId::A, 4),
        history: Vec::new(),
    };

    handle
        .apply_action(shoot_action(&handle, "A-BW", "B-SP"))
        .expect("shot should queue while line of sight is open");
    handle
        .apply_action(move_action_to(&handle, "A-AX", Coord { x: 1, y: 3 }))
        .expect("friendly movement should be able to block the lane later");

    handle
        .apply_action(Action::EndBound)
        .expect("end_bound should revalidate queued shot");

    assert!(handle.state.pending_shots.is_empty());
    assert!(!handle
        .state
        .recent_resolutions
        .iter()
        .any(|resolution| resolution.kind == engine_core::CombatKind::Missile));
    assert!(handle.state.log.iter().any(|entry| {
        entry
            .message
            .contains("Prepared missile fire A-BW -> B-SP had no effect")
            && entry
                .message
                .contains("target is no longer visible or in range")
    }));
}

#[test]
fn multiple_queued_shots_skip_a_target_removed_by_an_earlier_shot() {
    let units = vec![
        test_unit(
            "A-PS1",
            ArmyId::A,
            UnitKind::Psiloi,
            Coord { x: 0, y: 3 },
            Direction::E,
        ),
        test_unit(
            "A-PS2",
            ArmyId::A,
            UnitKind::Psiloi,
            Coord { x: 0, y: 4 },
            Direction::E,
        ),
        test_unit(
            "B-HD",
            ArmyId::B,
            UnitKind::Horde,
            Coord { x: 2, y: 3 },
            Direction::S,
        ),
    ];
    let mut handle = FastGameHandle {
        state: test_state(units, ArmyId::A, 2),
        history: Vec::new(),
    };

    handle
        .apply_action(shoot_action(&handle, "A-PS1", "B-HD"))
        .expect("first shot should queue");
    handle
        .apply_action(shoot_action(&handle, "A-PS2", "B-HD"))
        .expect("second shot should queue against the still-present target");

    handle
        .apply_action(Action::EndBound)
        .expect("end_bound should resolve queued shots in declaration order");

    let missile_resolutions = handle
        .state
        .recent_resolutions
        .iter()
        .filter(|resolution| resolution.kind == engine_core::CombatKind::Missile)
        .collect::<Vec<_>>();
    assert_eq!(missile_resolutions.len(), 1);
    assert_eq!(missile_resolutions[0].attacker_id, "A-PS1");
    assert_eq!(missile_resolutions[0].outcome, "destroy");
    assert!(unit_by_id(&handle, "B-HD").eliminated);
    assert!(handle.state.log.iter().any(|entry| {
        entry
            .message
            .contains("Prepared missile fire A-PS2 -> B-HD had no effect")
            && entry.message.contains("target is no longer present")
    }));
}

#[test]
fn panicked_elephant_disorders_friendly_pike_it_passes_through() {
    let mut elephant = test_unit(
        "A-EL",
        ArmyId::A,
        UnitKind::Elephants,
        Coord { x: 2, y: 2 },
        Direction::S,
    );
    elephant.quality = UnitQuality::Inferior;
    elephant.disordered = true;
    let units = vec![
        elephant,
        test_unit(
            "A-PK",
            ArmyId::A,
            UnitKind::Pike,
            Coord { x: 2, y: 3 },
            Direction::N,
        ),
        test_unit(
            "B-SP",
            ArmyId::B,
            UnitKind::Spear,
            Coord { x: 2, y: 1 },
            Direction::S,
        ),
    ];
    let mut handle = FastGameHandle {
        state: test_state(units, ArmyId::A, 1),
        history: Vec::new(),
    };

    let source = unit_by_id(&handle, "B-SP").clone();
    combat::resolve_panic_test(
        &mut handle.state,
        "A-EL",
        combat::PanicTrigger::DisplacedThroughFriends,
        Some(source),
    );

    assert_eq!(
        unit_by_id(&handle, "A-PK").formation_state,
        FormationState::DisorderedPike
    );
}

#[test]
fn panicked_unit_exiting_map_is_eliminated_and_adds_morale_loss() {
    let mut elephant = test_unit(
        "A-EL",
        ArmyId::A,
        UnitKind::Elephants,
        Coord { x: 2, y: 0 },
        Direction::N,
    );
    elephant.quality = UnitQuality::Inferior;
    elephant.disordered = true;
    let units = vec![
        elephant,
        test_unit(
            "B-SP",
            ArmyId::B,
            UnitKind::Spear,
            Coord { x: 2, y: 1 },
            Direction::S,
        ),
    ];
    let mut handle = FastGameHandle {
        state: test_state(units, ArmyId::A, 1),
        history: Vec::new(),
    };

    let source = unit_by_id(&handle, "B-SP").clone();
    combat::resolve_panic_test(
        &mut handle.state,
        "A-EL",
        combat::PanicTrigger::DisplacedThroughFriends,
        Some(source),
    );

    assert!(unit_by_id(&handle, "A-EL").eliminated);
    assert_eq!(army_morale_loss(&handle.state, ArmyId::A), 5);
}

#[test]
fn cavalry_causing_enemy_destroy_may_enter_overpursuit() {
    let mut cavalry = test_unit(
        "A-CV",
        ArmyId::A,
        UnitKind::Knights,
        Coord { x: 2, y: 3 },
        Direction::N,
    );
    cavalry.charging = true;
    let mut psiloi = test_unit(
        "B-PS",
        ArmyId::B,
        UnitKind::Psiloi,
        Coord { x: 2, y: 2 },
        Direction::S,
    );
    psiloi.quality = UnitQuality::Inferior;
    psiloi.disordered = true;
    let units = vec![cavalry, psiloi];
    let mut handle = FastGameHandle {
        state: test_state(units, ArmyId::A, 3),
        history: Vec::new(),
    };

    handle
        .apply_action(Action::EndBound)
        .expect("combat should resolve");

    assert_eq!(
        unit_by_id(&handle, "A-CV").formation_state,
        FormationState::Overpursuit
    );
}

#[test]
fn overpursuing_unit_cannot_receive_voluntary_orders() {
    let mut cavalry = test_unit(
        "A-CV",
        ArmyId::A,
        UnitKind::Cavalry,
        Coord { x: 2, y: 3 },
        Direction::N,
    );
    cavalry.formation_state = FormationState::Overpursuit;
    cavalry.overpursuit_turns_remaining = 1;
    let handle = FastGameHandle {
        state: test_state(vec![cavalry], ArmyId::A, 1),
        history: Vec::new(),
    };

    assert!(handle
        .legal_actions()
        .iter()
        .all(|action| !matches!(action, LegalAction::Move { unit_id, .. } | LegalAction::Rotate { unit_id, .. } if unit_id == "A-CV")));
}

#[test]
fn overpursuit_expires_after_owning_bound() {
    let mut cavalry = test_unit(
        "A-CV",
        ArmyId::A,
        UnitKind::Cavalry,
        Coord { x: 2, y: 3 },
        Direction::N,
    );
    cavalry.formation_state = FormationState::Overpursuit;
    cavalry.overpursuit_turns_remaining = 1;
    let units = vec![
        cavalry,
        test_unit(
            "B-SP",
            ArmyId::B,
            UnitKind::Spear,
            Coord { x: 7, y: 7 },
            Direction::S,
        ),
    ];
    let mut handle = FastGameHandle {
        state: test_state(units, ArmyId::B, 1),
        history: Vec::new(),
    };

    handle
        .apply_action(Action::EndBound)
        .expect("bound should pass to A");

    assert_eq!(
        unit_by_id(&handle, "A-CV").formation_state,
        FormationState::Normal
    );
}

#[test]
fn destroyed_guard_pike_adds_six_morale_loss() {
    let mut guard = test_unit(
        "B-GP",
        ArmyId::B,
        UnitKind::GuardPike,
        Coord { x: 2, y: 2 },
        Direction::N,
    );
    guard.quality = UnitQuality::Inferior;
    guard.disordered = true;
    guard.formation_state = FormationState::DisorderedPike;
    let mut attacker = test_unit(
        "A-KN",
        ArmyId::A,
        UnitKind::Knights,
        Coord { x: 2, y: 3 },
        Direction::N,
    );
    attacker.quality = UnitQuality::Superior;
    attacker.charging = true;
    let mut handle = FastGameHandle {
        state: test_state(vec![attacker, guard], ArmyId::A, 1),
        history: Vec::new(),
    };

    handle
        .apply_action(Action::EndBound)
        .expect("combat should resolve");

    assert!(unit_by_id(&handle, "B-GP").eliminated);
    assert_eq!(army_morale_loss(&handle.state, ArmyId::B), 6);
}

#[test]
fn destroyed_army_general_adds_leader_and_extra_morale_loss() {
    let mut leader = test_unit(
        "B-GEN",
        ArmyId::B,
        UnitKind::Leader,
        Coord { x: 2, y: 2 },
        Direction::N,
    );
    leader.leader = true;
    leader.army_general = true;
    leader.quality = UnitQuality::Inferior;
    leader.disordered = true;
    let mut attacker = test_unit(
        "A-KN",
        ArmyId::A,
        UnitKind::Knights,
        Coord { x: 2, y: 3 },
        Direction::N,
    );
    attacker.quality = UnitQuality::Superior;
    attacker.charging = true;
    let mut handle = FastGameHandle {
        state: test_state(vec![attacker, leader], ArmyId::A, 2),
        history: Vec::new(),
    };

    handle
        .apply_action(Action::EndBound)
        .expect("combat should resolve");

    assert!(unit_by_id(&handle, "B-GEN").eliminated);
    assert_eq!(army_morale_loss(&handle.state, ArmyId::B), 12);
}

#[test]
fn simultaneous_bound_end_resolution_is_replay_deterministic() {
    let units = vec![
        test_unit(
            "A-SP1",
            ArmyId::A,
            UnitKind::Spear,
            Coord { x: 2, y: 3 },
            Direction::N,
        ),
        test_unit(
            "B-SP1",
            ArmyId::B,
            UnitKind::Spear,
            Coord { x: 2, y: 2 },
            Direction::S,
        ),
        test_unit(
            "A-SP2",
            ArmyId::A,
            UnitKind::Spear,
            Coord { x: 5, y: 3 },
            Direction::N,
        ),
        test_unit(
            "B-SP2",
            ArmyId::B,
            UnitKind::Spear,
            Coord { x: 5, y: 2 },
            Direction::S,
        ),
    ];
    let mut left = FastGameHandle {
        state: test_state(units.clone(), ArmyId::A, 42),
        history: Vec::new(),
    };
    let mut right = FastGameHandle {
        state: test_state(units, ArmyId::A, 42),
        history: Vec::new(),
    };

    left.apply_action(Action::EndBound).expect("left resolves");
    right
        .apply_action(Action::EndBound)
        .expect("right resolves");

    assert_eq!(
        left.state.recent_resolutions,
        right.state.recent_resolutions
    );
    assert_eq!(left.state.units, right.state.units);
}

#[test]
fn close_combat_scores_are_planned_from_the_start_of_bound_snapshot() {
    let mut blade = test_unit(
        "A-BD",
        ArmyId::A,
        UnitKind::Blade,
        Coord { x: 2, y: 3 },
        Direction::N,
    );
    blade.quality = UnitQuality::Superior;
    let mut bow = test_unit(
        "B-BW",
        ArmyId::B,
        UnitKind::Bow,
        Coord { x: 2, y: 2 },
        Direction::S,
    );
    bow.quality = UnitQuality::Inferior;
    bow.disordered = true;
    let mut adjacent_spear = test_unit(
        "B-SP2",
        ArmyId::B,
        UnitKind::Spear,
        Coord { x: 3, y: 2 },
        Direction::S,
    );
    adjacent_spear.quality = UnitQuality::Inferior;
    let units = vec![
        blade,
        bow,
        test_unit(
            "A-SP2",
            ArmyId::A,
            UnitKind::Spear,
            Coord { x: 3, y: 3 },
            Direction::N,
        ),
        adjacent_spear,
    ];
    let mut state = test_state(units, ArmyId::A, 1);
    state.terrain = vec![TerrainTile {
        position: Coord { x: 2, y: 3 },
        terrain: TerrainType::Hill,
    }];
    let mut handle = FastGameHandle {
        state,
        history: Vec::new(),
    };

    handle
        .apply_action(Action::EndBound)
        .expect("combat should resolve");

    assert!(unit_by_id(&handle, "B-BW").eliminated);
    let spear_resolution = handle
        .state
        .recent_resolutions
        .iter()
        .find(|resolution| resolution.defender_id == "B-SP2")
        .expect("adjacent spear combat should still resolve");
    assert!(spear_resolution
        .defender_notes
        .iter()
        .any(|note| note == "quality -1"));
    assert!(!spear_resolution
        .defender_notes
        .iter()
        .any(|note| note == "disordered -1"));
}

#[test]
fn legal_charge_actions_warn_when_attacking_ordered_pike_front() {
    let units = vec![
        test_unit(
            "A-CV",
            ArmyId::A,
            UnitKind::Cavalry,
            Coord { x: 2, y: 4 },
            Direction::N,
        ),
        test_unit(
            "B-PK",
            ArmyId::B,
            UnitKind::Pike,
            Coord { x: 2, y: 2 },
            Direction::S,
        ),
    ];
    let handle = FastGameHandle {
        state: test_state(units, ArmyId::A, 1),
        history: Vec::new(),
    };

    let warning = handle
        .legal_actions()
        .into_iter()
        .find_map(|action| match action {
            LegalAction::Charge {
                unit_id,
                target_id,
                warning,
                ..
            } if unit_id == "A-CV" && target_id == "B-PK" => warning,
            _ => None,
        });

    assert_eq!(
        warning.as_deref(),
        Some("Charging an OrderedPike front will cancel shock and may trigger elephant/chariot panic.")
    );
}

#[test]
fn scenario_override_for_morale_value_is_used() {
    let scenario = ScenarioDefinition {
        scenario_id: "override".to_string(),
        name: "Override".to_string(),
        description: "Override".to_string(),
        board_width: 4,
        board_height: 4,
        terrain: Vec::new(),
        deployment_zones: Vec::new(),
        armies: Vec::new(),
        use_endgame_clock: false,
        units: vec![ScenarioUnit {
            id: "A-PK".to_string(),
            army: ArmyId::A,
            name: None,
            kind: UnitKind::Pike,
            position: Coord { x: 1, y: 3 },
            facing: Direction::N,
            leader: false,
            formation_class: None,
            quality: None,
            in_command: None,
            disordered: None,
            can_evade: None,
            activated_this_bound: None,
            charging: None,
            eliminated: None,
            unit_class: None,
            formation_state: None,
            pursuit_class: None,
            morale_value: Some(9),
            has_routed_before: None,
            overpursuit_turns_remaining: None,
            panic_turns_remaining: None,
            army_general: None,
            deployed: None,
            off_map: None,
        }],
    };

    let state = scenario.build_game_state("game".to_string(), 1);

    assert_eq!(state.units[0].morale_value, 9);
}

#[test]
fn scenario_override_for_morale_threshold_is_used() {
    let scenario = ScenarioDefinition {
        scenario_id: "threshold".to_string(),
        name: "Threshold".to_string(),
        description: "Threshold".to_string(),
        board_width: 4,
        board_height: 4,
        terrain: Vec::new(),
        deployment_zones: Vec::new(),
        armies: vec![ScenarioArmy {
            id: ArmyId::A,
            morale_threshold: Some(11),
        }],
        use_endgame_clock: false,
        units: vec![ScenarioUnit {
            id: "A-SP".to_string(),
            army: ArmyId::A,
            name: None,
            kind: UnitKind::Spear,
            position: Coord { x: 1, y: 3 },
            facing: Direction::N,
            leader: false,
            formation_class: None,
            quality: None,
            in_command: None,
            disordered: None,
            can_evade: None,
            activated_this_bound: None,
            charging: None,
            eliminated: None,
            unit_class: None,
            formation_state: None,
            pursuit_class: None,
            morale_value: None,
            has_routed_before: None,
            overpursuit_turns_remaining: None,
            panic_turns_remaining: None,
            army_general: None,
            deployed: None,
            off_map: None,
        }],
    };

    let state = scenario.build_game_state("game".to_string(), 1);

    assert_eq!(
        state
            .armies
            .iter()
            .find(|army| army.id == ArmyId::A)
            .map(|army| army.morale_threshold),
        Some(11)
    );
}
