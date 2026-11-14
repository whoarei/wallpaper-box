/// Fit a logical popup into a physical monitor work area (taskbar excluded).
pub(super) fn place(
    (left, top, available_width, available_height): (i32, i32, i32, i32),
    scale: f64,
    (cursor_x, cursor_y): (f64, f64),
) -> (i32, i32, u32, u32) {
    let margin = (8.0 * scale).round() as i32;
    let width = ((320.0 * scale).round() as i32).min(available_width).max(1);
    let height = ((548.0 * scale).round() as i32)
        .min(available_height)
        .max(1);
    let x = (cursor_x as i32 - width + margin).clamp(left, left + available_width - width);
    let y = (cursor_y as i32 - height + margin).clamp(top, top + available_height - height);
    (x, y, width as u32, height as u32)
}

#[cfg(test)]
mod tests {
    use super::place;

    #[test]
    fn opens_above_a_bottom_taskbar_at_the_clicked_dpi() {
        assert_eq!(
            place((0, 0, 1920, 1032), 1.0, (1900.0, 1056.0)),
            (1588, 484, 320, 548)
        );
        assert_eq!(
            place((0, 0, 3840, 2064), 2.0, (3800.0, 2112.0)),
            (3176, 968, 640, 1096)
        );
    }

    #[test]
    fn keeps_all_taskbar_edges_and_negative_monitor_origins_inside_the_work_area() {
        for area in [
            (0, 0, 1920, 1032),
            (0, 48, 1920, 1032),
            (48, 0, 1872, 1080),
            (0, 0, 1872, 1080),
            (-1920, -1080, 1920, 1032),
        ] {
            for scale in [1.0, 1.25, 1.5, 2.0] {
                for point in [(-1920.0, -1080.0), (0.0, 0.0), (1900.0, 1060.0)] {
                    let (x, y, width, height) = place(area, scale, point);
                    assert!(x >= area.0 && y >= area.1);
                    assert!(x + width as i32 <= area.0 + area.2);
                    assert!(y + height as i32 <= area.1 + area.3);
                }
            }
        }
    }

    #[test]
    fn shrinks_to_a_small_work_area_instead_of_clipping_controls() {
        assert_eq!(
            place((-280, 40, 280, 360), 1.5, (-5.0, 420.0)),
            (-280, 40, 280, 360)
        );
    }
}
