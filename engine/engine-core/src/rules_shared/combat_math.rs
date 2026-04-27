use super::*;

pub(crate) fn quality_modifier(unit: &Unit) -> i32 {
    match unit.quality {
        UnitQuality::Superior => 1,
        UnitQuality::Inferior => -1,
        UnitQuality::Ordinary => 0,
    }
}

pub(crate) fn charge_impact_bonus(
    state: &GameState,
    unit: &Unit,
    opponent: &Unit,
    incoming_aspect: &str,
) -> i32 {
    if !unit.charging {
        return 0;
    }

    if incoming_aspect == "front"
        && is_ordered_pike(opponent, state)
        && matches!(
            get_unit_class(unit),
            UnitClass::Cavalry | UnitClass::Elephant | UnitClass::Chariot
        )
    {
        return 0;
    }

    match unit.kind {
        UnitKind::Cavalry | UnitKind::Knights => 3,
        UnitKind::Spear | UnitKind::Blade => 1,
        _ => 0,
    }
}

pub(crate) fn charge_impact_note(
    state: &GameState,
    unit: &Unit,
    opponent: &Unit,
    incoming_aspect: &str,
) -> Option<String> {
    if unit.charging
        && incoming_aspect == "front"
        && is_ordered_pike(opponent, state)
        && matches!(
            get_unit_class(unit),
            UnitClass::Cavalry | UnitClass::Elephant | UnitClass::Chariot
        )
    {
        return Some("charge shock canceled by ordered pike".to_string());
    }
    let bonus = charge_impact_bonus(state, unit, opponent, incoming_aspect);
    if bonus == 0 {
        return None;
    }
    Some(format!("charge impact +{bonus}"))
}

pub(crate) fn ordered_pike_combat_bonus(
    state: &GameState,
    unit: &Unit,
    opponent: &Unit,
    acting_as_attacker: bool,
) -> i32 {
    if !is_ordered_pike(unit, state) || !is_front_contact(unit, opponent) {
        return 0;
    }
    if acting_as_attacker {
        return 3;
    }
    if opponent.charging
        && matches!(
            get_unit_class(opponent),
            UnitClass::Cavalry | UnitClass::Elephant | UnitClass::Chariot
        )
    {
        return 5;
    }
    4
}

pub(crate) fn get_disorder_combat_penalty(unit: &Unit) -> i32 {
    if unit.formation_state == FormationState::DisorderedPike {
        -2
    } else if unit.disordered {
        -1
    } else {
        0
    }
}

pub(crate) fn flank_supporter<'a>(
    state: &'a GameState,
    unit: &Unit,
    direction: &Direction,
) -> Option<&'a Unit> {
    let (dx, dy) = direction_delta(direction);
    let units_by_pos: HashMap<(i32, i32), &Unit> = state
        .units
        .iter()
        .filter(|candidate| !candidate.eliminated)
        .map(|candidate| ((candidate.position.x, candidate.position.y), candidate))
        .collect();
    let supporter = units_by_pos.get(&(unit.position.x + dx, unit.position.y + dy))?;
    if supporter.army != unit.army || supporter.facing != unit.facing {
        return None;
    }
    if matches!(supporter.formation_class, FormationClass::OpenOrder)
        && matches!(unit.formation_class, FormationClass::CloseOrder)
    {
        return None;
    }
    if !adjacent_enemies(state, supporter).is_empty() {
        return None;
    }
    Some(*supporter)
}

pub(crate) fn frontage_pressure_penalty(
    unit: &Unit,
    opponent: &Unit,
    frontage: Option<&FrontageContext>,
) -> i32 {
    let Some(frontage) = frontage else {
        return 0;
    };
    if !frontage.lane_value_by_unit.contains_key(&unit.id)
        || !frontage.lane_value_by_unit.contains_key(&opponent.id)
    {
        return 0;
    }

    let mut penalty = 0;
    let lane_value = frontage.lane_value_by_unit[&unit.id];
    let friendly_lanes = frontage.unit_by_lane.get(&unit.army);
    let enemy_lanes = frontage.unit_by_lane.get(&opponent.army);
    for offset in [-1, 1] {
        let adjacent_lane = lane_value + offset;
        if enemy_lanes.is_some_and(|lanes| lanes.contains_key(&adjacent_lane))
            && friendly_lanes.is_none_or(|lanes| !lanes.contains_key(&adjacent_lane))
        {
            penalty -= 1;
        }
    }
    penalty
}

pub(crate) fn extra_contact_aspects(
    state: &GameState,
    unit: &Unit,
    opponent: &Unit,
) -> Vec<String> {
    let mut aspects = Vec::new();
    for enemy in adjacent_enemies(state, unit) {
        if enemy.id == opponent.id {
            continue;
        }
        aspects.push(attack_aspect(enemy, unit).to_string());
    }
    aspects
}

pub(crate) fn extra_contact_penalty(state: &GameState, unit: &Unit, opponent: &Unit) -> i32 {
    let mut penalty = 0;
    for aspect in extra_contact_aspects(state, unit, opponent) {
        match aspect.as_str() {
            "rear" => penalty -= 2,
            "side" => penalty -= 1,
            _ => {}
        }
    }
    penalty
}

pub(crate) fn extra_contact_note(
    state: &GameState,
    unit: &Unit,
    opponent: &Unit,
) -> Option<String> {
    let aspects = extra_contact_aspects(state, unit, opponent);
    if aspects.is_empty() {
        return None;
    }

    let side_count = aspects
        .iter()
        .filter(|aspect| aspect.as_str() == "side")
        .count();
    let rear_count = aspects
        .iter()
        .filter(|aspect| aspect.as_str() == "rear")
        .count();
    let raw_penalty = extra_contact_penalty(state, unit, opponent);
    let applied_penalty = raw_penalty.max(-2);

    if rear_count == 1 && side_count == 0 {
        return Some(format!("extra rear contact {applied_penalty:+}"));
    }
    if side_count == 1 && rear_count == 0 {
        return Some(format!("extra side contact {applied_penalty:+}"));
    }
    if side_count == 2 && rear_count == 0 && raw_penalty == -2 {
        return Some("two extra side contacts -2".to_string());
    }
    if raw_penalty < -2 {
        return Some("multiple extra contacts -2 (capped)".to_string());
    }
    Some(format!("multiple extra contacts {applied_penalty:+}"))
}

pub(crate) fn contact_pressure_penalty(
    state: &GameState,
    unit: &Unit,
    opponent: &Unit,
    frontage: Option<&FrontageContext>,
) -> i32 {
    (frontage_pressure_penalty(unit, opponent, frontage)
        + extra_contact_penalty(state, unit, opponent))
    .max(-2)
}

pub(crate) fn frontage_overlap_bonus(
    unit: &Unit,
    opponent: &Unit,
    frontage: Option<&FrontageContext>,
) -> i32 {
    let Some(frontage) = frontage else {
        return 0;
    };
    if !frontage.lane_value_by_unit.contains_key(&unit.id)
        || !frontage.lane_value_by_unit.contains_key(&opponent.id)
    {
        return 0;
    }

    let mut bonus = 0;
    let lane_value = frontage.lane_value_by_unit[&unit.id];
    let friendly_lanes = frontage.unit_by_lane.get(&unit.army);
    let enemy_lanes = frontage.unit_by_lane.get(&opponent.army);
    for offset in [-1, 1] {
        let adjacent_lane = lane_value + offset;
        let Some(friendly_id) = friendly_lanes.and_then(|lanes| lanes.get(&adjacent_lane)) else {
            continue;
        };
        if frontage.pair_by_unit.contains_key(friendly_id) {
            continue;
        }
        if enemy_lanes.is_some_and(|lanes| lanes.contains_key(&adjacent_lane)) {
            continue;
        }
        bonus += 1;
    }
    bonus
}

pub(crate) fn overlap_bonus(
    state: &GameState,
    unit: &Unit,
    opponent: &Unit,
    incoming_aspect: &str,
    frontage: Option<&FrontageContext>,
) -> i32 {
    if incoming_aspect != "front" {
        return 0;
    }

    let frontage_bonus = frontage_overlap_bonus(unit, opponent, frontage);
    if frontage_bonus != 0 {
        return frontage_bonus;
    }

    let mut bonus = 0;
    let (left, right) = flank_directions(&unit.facing);
    for direction in [left, right] {
        let supporter = flank_supporter(state, unit, &direction);
        if supporter.is_none() {
            continue;
        }
        if flank_supporter(state, opponent, &direction).is_some() {
            continue;
        }
        bonus += 1;
    }
    bonus
}

pub(crate) fn terrain_combat_bonus(state: &GameState, unit: &Unit, opponent: Option<&Unit>) -> i32 {
    let terrain = terrain_for_unit(state, unit);
    let opponent_terrain = opponent
        .map(|opponent| terrain_for_unit(state, opponent))
        .unwrap_or(TerrainType::Open);
    let mut bonus = 0;
    if matches!(terrain, TerrainType::Hill) && !matches!(opponent_terrain, TerrainType::Hill) {
        bonus += 1;
    }
    if matches!(terrain, TerrainType::Forest) {
        if matches!(unit.formation_class, FormationClass::OpenOrder) {
            bonus += 1;
        } else if is_mounted(&unit.kind) {
            bonus -= 2;
        } else {
            bonus -= 1;
        }
    }
    bonus
}

pub(crate) fn aspect_priority(aspect: &str) -> i32 {
    match aspect {
        "front" => 0,
        "side" => 1,
        "rear" => 2,
        _ => 0,
    }
}

pub(crate) fn aspect_combat_modifier(aspect: &str, attacker: bool) -> i32 {
    if attacker {
        match aspect {
            "front" => 0,
            "side" => 1,
            "rear" => 2,
            _ => 0,
        }
    } else {
        match aspect {
            "front" => 0,
            "side" => -1,
            "rear" => -2,
            _ => 0,
        }
    }
}

pub(crate) fn aspect_modifier_note(aspect: &str, acting_as_attacker: bool) -> Option<String> {
    let modifier = aspect_combat_modifier(aspect, acting_as_attacker);
    if modifier == 0 {
        return None;
    }
    if acting_as_attacker {
        match aspect {
            "side" => Some(format!("flank attack {modifier:+}")),
            "rear" => Some(format!("rear attack {modifier:+}")),
            _ => Some(format!("attack position {modifier:+}")),
        }
    } else {
        match aspect {
            "side" => Some(format!("defending against flank attack {modifier:+}")),
            "rear" => Some(format!("defending against rear attack {modifier:+}")),
            _ => Some(format!("attack position {modifier:+}")),
        }
    }
}

pub(crate) fn format_notes(notes: &[String]) -> String {
    if notes.is_empty() {
        " [no modifiers]".to_string()
    } else {
        format!(" [{}]", notes.join(", "))
    }
}

pub(crate) fn combat_modifier_notes(
    state: &GameState,
    unit: &Unit,
    opponent: &Unit,
    incoming_aspect: &str,
    acting_as_attacker: bool,
    frontage: Option<&FrontageContext>,
) -> Vec<String> {
    let mut notes = Vec::new();
    let support = rear_support_bonus(state, unit, incoming_aspect, frontage);
    if support != 0 {
        notes.push(format!("rear support +{support}"));
    }
    let frontage_overlap = frontage_overlap_bonus(unit, opponent, frontage);
    let overlap = overlap_bonus(state, unit, opponent, incoming_aspect, frontage);
    if overlap != 0 {
        notes.push(format!(
            "{} +{overlap}",
            if frontage_overlap != 0 {
                "free flank support"
            } else {
                "overlap"
            }
        ));
    }
    let terrain = terrain_combat_bonus(state, unit, Some(opponent));
    if terrain != 0 {
        notes.push(format!("terrain {terrain:+}"));
    }
    let quality = quality_modifier(unit);
    if quality != 0 {
        notes.push(format!("quality {quality:+}"));
    }
    let aura = command_aura_bonus(state, unit);
    if aura != 0 {
        notes.push(format!("general aura +{aura}"));
    }
    let disorder = get_disorder_combat_penalty(unit);
    if disorder != 0 {
        if unit.formation_state == FormationState::DisorderedPike {
            notes.push("disordered pike -2".to_string());
        } else {
            notes.push("disordered -1".to_string());
        }
    }
    let pike_bonus = ordered_pike_combat_bonus(state, unit, opponent, acting_as_attacker);
    if pike_bonus != 0 {
        if acting_as_attacker {
            notes.push(format!("ordered pike frontal attack +{pike_bonus}"));
        } else if pike_bonus == 5 {
            notes.push("ordered pike vs mounted shock +5".to_string());
        } else {
            notes.push(format!("ordered pike frontal defense +{pike_bonus}"));
        }
    }
    if let Some(note) = charge_impact_note(state, unit, opponent, incoming_aspect) {
        notes.push(note);
    }
    let frontage_pressure = frontage_pressure_penalty(unit, opponent, frontage);
    let extra_contact = extra_contact_penalty(state, unit, opponent);
    let pressure = contact_pressure_penalty(state, unit, opponent, frontage);
    if pressure != 0 {
        if frontage_pressure != 0
            && extra_contact != 0
            && frontage_pressure + extra_contact < pressure
        {
            notes.push(format!(
                "line pressure and extra contacts {pressure:+} (capped)"
            ));
        } else {
            if frontage_pressure != 0 {
                notes.push(format!("outflanked on the line {frontage_pressure:+}"));
            }
            if let Some(extra_note) = extra_contact_note(state, unit, opponent) {
                notes.push(extra_note);
            }
        }
    }
    if let Some(note) = aspect_modifier_note(incoming_aspect, acting_as_attacker) {
        notes.push(note);
    }
    notes
}

pub(crate) fn missile_modifier_notes(
    state: &GameState,
    attacker: &Unit,
    defender: &Unit,
) -> Vec<String> {
    let mut notes = Vec::new();
    let attacker_terrain = terrain_for_unit(state, attacker);
    let defender_terrain = terrain_for_unit(state, defender);
    if matches!(attacker_terrain, TerrainType::Hill)
        && !matches!(defender_terrain, TerrainType::Hill)
    {
        notes.push("uphill fire +1".to_string());
    }
    if matches!(attacker_terrain, TerrainType::Forest) {
        notes.push("forest firing -1".to_string());
    }
    if matches!(defender_terrain, TerrainType::Hill)
        && !matches!(attacker_terrain, TerrainType::Hill)
    {
        notes.push("target uphill -1".to_string());
    }
    if matches!(&attacker.kind, UnitKind::Bow) && is_mounted(&defender.kind) {
        notes.push("bow vs mounted +1".to_string());
    }
    if matches!(
        &defender.kind,
        UnitKind::Bow | UnitKind::Slinger | UnitKind::Psiloi
    ) && !matches!(defender_terrain, TerrainType::Forest)
    {
        notes.push("light target +1".to_string());
    }
    let quality = quality_modifier(attacker);
    if quality != 0 {
        notes.push(format!("quality {quality:+}"));
    }
    let aura = command_aura_bonus(state, attacker);
    if aura != 0 {
        notes.push("general aura +1".to_string());
    }
    let disorder = get_disorder_combat_penalty(attacker);
    if disorder != 0 {
        notes.push(format!("disordered {disorder}"));
    }
    notes
}

pub(crate) fn missile_defense_notes(state: &GameState, defender: &Unit) -> Vec<String> {
    let mut notes = Vec::new();
    let terrain = terrain_for_unit(state, defender);
    if matches!(terrain, TerrainType::Forest | TerrainType::Hill) {
        notes.push(format!("{terrain:?} cover +1"));
    }
    let quality = quality_modifier(defender);
    if quality != 0 {
        notes.push(format!("quality {quality:+}"));
    }
    let disorder = get_disorder_combat_penalty(defender);
    if disorder != 0 {
        notes.push(format!("disordered {disorder}"));
    }
    notes
}

pub(crate) fn rear_support_bonus(
    state: &GameState,
    unit: &Unit,
    incoming_aspect: &str,
    frontage: Option<&FrontageContext>,
) -> i32 {
    let profile = unit_profile(&unit.kind);
    if !profile.support_eligible || incoming_aspect != "front" {
        return 0;
    }

    let (dx, dy) = direction_delta(&unit.facing);
    let units_by_pos: HashMap<(i32, i32), &Unit> = state
        .units
        .iter()
        .filter(|candidate| !candidate.eliminated)
        .map(|candidate| ((candidate.position.x, candidate.position.y), candidate))
        .collect();
    let Some(supporter) = units_by_pos.get(&(unit.position.x - dx, unit.position.y - dy)) else {
        return 0;
    };
    let supporter_profile = unit_profile(&supporter.kind);
    if supporter.army != unit.army
        || supporter.facing != unit.facing
        || !supporter_profile.support_eligible
        || frontage.is_some_and(|frontage| frontage.pair_by_unit.contains_key(&supporter.id))
        || !adjacent_enemies(state, supporter).is_empty()
    {
        return 0;
    }
    1
}

pub(crate) fn close_combat_score(
    state: &GameState,
    unit: &Unit,
    opponent: &Unit,
    incoming_aspect: &str,
    acting_as_attacker: bool,
    frontage: Option<&FrontageContext>,
) -> i32 {
    let profile = unit_profile(&unit.kind);
    let mut score = if is_mounted(&opponent.kind) {
        profile.close_vs_mounted
    } else {
        profile.close_vs_foot
    };
    score += rear_support_bonus(state, unit, incoming_aspect, frontage);
    score += overlap_bonus(state, unit, opponent, incoming_aspect, frontage);
    score += terrain_combat_bonus(state, unit, Some(opponent));
    score += contact_pressure_penalty(state, unit, opponent, frontage);
    score += aspect_combat_modifier(incoming_aspect, acting_as_attacker);
    score += quality_modifier(unit);
    score += command_aura_bonus(state, unit);
    score += ordered_pike_combat_bonus(state, unit, opponent, acting_as_attacker);
    score += charge_impact_bonus(state, unit, opponent, incoming_aspect);
    score += get_disorder_combat_penalty(unit);
    score.max(1)
}

pub(crate) fn missile_attack_score(state: &GameState, attacker: &Unit, defender: &Unit) -> i32 {
    let profile = unit_profile(&attacker.kind);
    let mut score = profile.missile_strength;
    let attacker_terrain = terrain_for_unit(state, attacker);
    let defender_terrain = terrain_for_unit(state, defender);
    if matches!(attacker_terrain, TerrainType::Hill)
        && !matches!(defender_terrain, TerrainType::Hill)
    {
        score += 1;
    }
    if matches!(attacker_terrain, TerrainType::Forest) {
        score -= 1;
    }
    if matches!(defender_terrain, TerrainType::Hill)
        && !matches!(attacker_terrain, TerrainType::Hill)
    {
        score -= 1;
    }
    if matches!(&attacker.kind, UnitKind::Bow) && is_mounted(&defender.kind) {
        score += 1;
    }
    if matches!(
        &defender.kind,
        UnitKind::Bow | UnitKind::Slinger | UnitKind::Psiloi
    ) && !matches!(defender_terrain, TerrainType::Forest)
    {
        score += 1;
    }
    score += quality_modifier(attacker);
    score += command_aura_bonus(state, attacker);
    score += get_disorder_combat_penalty(attacker);
    score.max(1)
}

pub(crate) fn missile_defense_score(state: &GameState, defender: &Unit) -> i32 {
    let mut score = unit_profile(&defender.kind).missile_defense;
    let terrain = terrain_for_unit(state, defender);
    if matches!(terrain, TerrainType::Forest | TerrainType::Hill) {
        score += 1;
    }
    score += quality_modifier(defender);
    score += get_disorder_combat_penalty(defender);
    score
}

pub(crate) fn attack_aspect(attacker: &Unit, defender: &Unit) -> &'static str {
    let attacker_cells = footprint_keys_for(&attacker.position, &attacker.facing);
    if attacker_cells.into_iter().any(|cell| {
        edge_contact_keys_for(&defender.position, &defender.facing, &defender.facing)
            .contains(&cell)
    }) {
        return "front";
    }
    if attacker_cells.into_iter().any(|cell| {
        edge_contact_keys_for(
            &defender.position,
            &defender.facing,
            &opposite_direction(&defender.facing),
        )
        .contains(&cell)
    }) {
        return "rear";
    }
    "side"
}

pub(crate) fn can_shoot_over_friendly(shooter: &Unit, friendly: &Unit) -> bool {
    let shooter_profile = unit_profile(&shooter.kind);
    let friendly_profile = unit_profile(&friendly.kind);
    shooter_profile.screen_height > friendly_profile.screen_height
        || (matches!(shooter.formation_class, FormationClass::CloseOrder)
            && matches!(friendly.formation_class, FormationClass::OpenOrder))
}

pub(crate) fn missile_forward_and_lateral(
    source: &Coord,
    target: &Coord,
    facing: &Direction,
) -> Option<(i32, i32)> {
    let dx = target.x - source.x;
    let dy = target.y - source.y;
    let (forward, lateral) = match facing {
        Direction::N => (-dy, dx.abs()),
        Direction::E => (dx, dy.abs()),
        Direction::S => (dy, dx.abs()),
        Direction::W => (-dx, dy.abs()),
    };
    (forward > 0).then_some((forward, lateral))
}

pub(crate) fn missile_path_cells(source: &Coord, target: &Coord) -> Vec<Coord> {
    let dx = target.x - source.x;
    let dy = target.y - source.y;
    let nx = dx.abs();
    let ny = dy.abs();
    let step_x = dx.signum();
    let step_y = dy.signum();
    let mut x = source.x;
    let mut y = source.y;
    let mut ix = 0;
    let mut iy = 0;
    let mut cells = vec![Coord { x, y }];

    while ix < nx || iy < ny {
        let decision = ((1 + (2 * ix)) * ny) - ((1 + (2 * iy)) * nx);
        if decision == 0 {
            x += step_x;
            y += step_y;
            ix += 1;
            iy += 1;
        } else if decision < 0 {
            x += step_x;
            ix += 1;
        } else {
            y += step_y;
            iy += 1;
        }
        cells.push(Coord { x, y });
    }
    cells
}

pub(crate) fn missile_target_range(shooter: &Unit, target: &Unit) -> Option<i32> {
    let profile = unit_profile(&shooter.kind);
    let (forward, lateral) =
        missile_forward_and_lateral(&shooter.position, &target.position, &shooter.facing)?;
    (forward <= profile.missile_range && lateral <= MISSILE_SECTOR_LATERAL_LIMIT).then_some(forward)
}

pub(crate) fn has_clear_missile_path(
    state: &GameState,
    shooter: &Unit,
    target: &Unit,
    occupied: &HashMap<(i32, i32), String>,
) -> bool {
    let mut obscuring = 0;
    for coord in missile_path_cells(&shooter.position, &target.position)
        .into_iter()
        .skip(1)
    {
        if coord == target.position {
            return occupied
                .get(&(coord.x, coord.y))
                .is_some_and(|occupant_id| occupant_id == &target.id);
        }

        if let Some(occupant_id) = occupied.get(&(coord.x, coord.y)) {
            let Some(occupant) = find_unit(state, occupant_id) else {
                return false;
            };
            if occupant.army == shooter.army
                && can_shoot_over_friendly(shooter, occupant)
                && obscuring == 0
            {
                obscuring += 1;
                continue;
            }
            return false;
        }

        obscuring += missile_obstruction_cost(state, &coord);
        if obscuring > 1 {
            return false;
        }
    }
    false
}

pub(crate) fn has_clear_missile_path_with_indexes(
    state: &GameState,
    indexes: &GameIndexes,
    shooter: &Unit,
    target: &Unit,
    occupied: &HashMap<(i32, i32), String>,
) -> bool {
    let mut obscuring = 0;
    for coord in missile_path_cells(&shooter.position, &target.position)
        .into_iter()
        .skip(1)
    {
        if coord == target.position {
            return occupied
                .get(&(coord.x, coord.y))
                .is_some_and(|occupant_id| occupant_id == &target.id);
        }

        if let Some(occupant_id) = occupied.get(&(coord.x, coord.y)) {
            let Some(occupant) = indexes.find_unit(state, occupant_id) else {
                return false;
            };
            if occupant.army == shooter.army
                && can_shoot_over_friendly(shooter, occupant)
                && obscuring == 0
            {
                obscuring += 1;
                continue;
            }
            return false;
        }

        obscuring += missile_obstruction_cost_with_indexes(indexes, &coord);
        if obscuring > 1 {
            return false;
        }
    }
    false
}

pub(crate) fn missile_obstruction_cost(state: &GameState, coord: &Coord) -> i32 {
    match terrain_at(state, coord) {
        TerrainType::Forest | TerrainType::Hill => 1,
        _ => 0,
    }
}

pub(crate) fn missile_obstruction_cost_with_indexes(indexes: &GameIndexes, coord: &Coord) -> i32 {
    match indexes.terrain_at(coord) {
        TerrainType::Forest | TerrainType::Hill => 1,
        _ => 0,
    }
}

pub(crate) fn visible_enemies_in_sector<'a>(
    state: &'a GameState,
    unit: &Unit,
    occupied: &HashMap<(i32, i32), String>,
) -> Vec<(&'a Unit, i32)> {
    let mut visible: Vec<(&Unit, i32, i32)> = state
        .units
        .iter()
        .filter(|candidate| !candidate.eliminated && candidate.army != unit.army)
        .filter_map(|candidate| {
            let range = missile_target_range(unit, candidate)?;
            let (_, lateral) =
                missile_forward_and_lateral(&unit.position, &candidate.position, &unit.facing)?;
            has_clear_missile_path(state, unit, candidate, occupied)
                .then_some((candidate, range, lateral))
        })
        .collect();

    visible.sort_by(
        |(left_unit, left_range, left_lateral), (right_unit, right_range, right_lateral)| {
            left_range
                .cmp(right_range)
                .then(left_lateral.cmp(right_lateral))
                .then(left_unit.position.y.cmp(&right_unit.position.y))
                .then(left_unit.position.x.cmp(&right_unit.position.x))
                .then(left_unit.id.cmp(&right_unit.id))
        },
    );

    visible
        .into_iter()
        .map(|(target, range, _)| (target, range))
        .collect()
}

pub(crate) fn visible_enemies_in_sector_with_indexes<'a>(
    state: &'a GameState,
    indexes: &'a GameIndexes,
    unit: &Unit,
    occupied: &HashMap<(i32, i32), String>,
) -> Vec<(&'a Unit, i32)> {
    let enemy_army = unit.army.other();
    let mut visible: Vec<(&Unit, i32, i32)> = indexes
        .active_units(state, &enemy_army)
        .filter_map(|candidate| {
            let range = missile_target_range(unit, candidate)?;
            let (_, lateral) =
                missile_forward_and_lateral(&unit.position, &candidate.position, &unit.facing)?;
            has_clear_missile_path_with_indexes(state, indexes, unit, candidate, occupied)
                .then_some((candidate, range, lateral))
        })
        .collect();

    visible.sort_by(
        |(left_unit, left_range, left_lateral), (right_unit, right_range, right_lateral)| {
            left_range
                .cmp(right_range)
                .then(left_lateral.cmp(right_lateral))
                .then(left_unit.position.y.cmp(&right_unit.position.y))
                .then(left_unit.position.x.cmp(&right_unit.position.x))
                .then(left_unit.id.cmp(&right_unit.id))
        },
    );

    visible
        .into_iter()
        .map(|(target, range, _)| (target, range))
        .collect()
}
