use super::*;

pub fn build_compact_unit_profiles(units: &[Unit]) -> String {
    let mut kinds = units
        .iter()
        .map(|unit| unit.kind.clone())
        .collect::<Vec<_>>();
    if kinds.is_empty() {
        return "PROFILE -".to_string();
    }
    kinds.sort_by_key(|left| left.to_string());
    kinds.dedup_by(|left, right| left.to_string() == right.to_string());

    let lines = kinds
        .into_iter()
        .map(|kind| {
            let profile = unit_profile(&kind);
            let missile_token = if profile.missile_range <= 0 || profile.missile_strength <= 0 {
                "-".to_string()
            } else {
                format!("{}/{}", profile.missile_range, profile.missile_strength)
            };
            let pass_token = if profile.interpenetrates_friends.is_empty() {
                "-".to_string()
            } else {
                profile
                    .interpenetrates_friends
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join(",")
            };
            format!(
                "PROFILE {kind} mv={} march=+{} close={}/{} msl={} mdef={} sup={} pur={} mounted={} scr={} pass={}",
                profile.movement,
                profile.march_bonus,
                profile.close_vs_foot,
                profile.close_vs_mounted,
                missile_token,
                profile.missile_defense,
                profile.support_eligible as i32,
                profile.pursuit_distance,
                profile.mounted as i32,
                profile.screen_height,
                pass_token
            )
        })
        .collect::<Vec<_>>();
    if lines.is_empty() {
        "PROFILE -".to_string()
    } else {
        lines.join("\n")
    }
}
