<?php
/**
 * Plugin Name: BCS Magazine Custom Layer (Override)
 * Description: Overrides the [magazine_plug] shortcode to use the GitHub-hosted runtime (magazine.js / magazine.css) and prevents legacy runtime from loading (fixes double page turns).
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) exit;

final class BCS_Magazine_Custom_Layer {
  const SHORTCODE = 'magazine_plug';

  public static function init() {
    // Override any existing shortcode with the same tag.
    add_action('init', [__CLASS__, 'register_shortcode'], 1000);

    // Last-chance dequeue for common legacy handles (safe no-ops if missing).
    add_action('wp_print_scripts', [__CLASS__, 'dequeue_legacy_assets'], 9999);
    add_action('wp_print_styles',  [__CLASS__, 'dequeue_legacy_assets'], 9999);
  }

  public static function register_shortcode() {
    if (shortcode_exists(self::SHORTCODE)) {
      remove_shortcode(self::SHORTCODE);
    }
    add_shortcode(self::SHORTCODE, [__CLASS__, 'render_shortcode']);
  }

  private static function base_from_json_url($json_url) {
    $json_url = trim((string)$json_url);
    if ($json_url === '') return '';
    // Ensure ends with a trailing slash directory
    $base = preg_replace('#/[^/?#]+(\?.*)?$#', '/', $json_url);
    return $base;
  }

  public static function render_shortcode($atts = [], $content = null) {
    $atts = shortcode_atts([
      'json_url' => '',
      // Optional JSON config that will be placed into data-config
      'config' => '',
      // Optional: explicitly set runtime asset URLs (rare)
      'js_url' => '',
      'css_url' => '',
    ], $atts, self::SHORTCODE);

    $json_url = esc_url_raw($atts['json_url']);
    if (!$json_url) {
      return '<div class="mag-plug" style="padding:16px;border:1px solid #ddd;background:#fff">Missing json_url.</div>';
    }

    $base = self::base_from_json_url($json_url);

    $css_url = $atts['css_url'] ? esc_url_raw($atts['css_url']) : ($base ? $base . 'magazine.css' : '');
    $js_url  = $atts['js_url']  ? esc_url_raw($atts['js_url'])  : ($base ? $base . 'magazine.js'  : '');

    // Cache-bust using a short window so WP caches don't hold stale runtime.
    $ver = (string) floor(time() / 300); // 5-minute bucket

    if ($css_url) {
      wp_enqueue_style('bcs-magazine-runtime', $css_url, [], $ver);
    }
    if ($js_url) {
      wp_enqueue_script('bcs-magazine-runtime', $js_url, [], $ver, true);
    }

    // Build config
    $cfg = [];
    if (!empty($atts['config'])) {
      $decoded = json_decode($atts['config'], true);
      if (is_array($decoded)) $cfg = $decoded;
    }

    // Sensible defaults (can be overridden via config JSON)
    if (!isset($cfg['enableKeyboard'])) $cfg['enableKeyboard'] = true;
    if (!isset($cfg['announcePageChanges'])) $cfg['announcePageChanges'] = true;
    if (!isset($cfg['respectReducedMotion'])) $cfg['respectReducedMotion'] = true;

    $cfg_attr = esc_attr(wp_json_encode($cfg));

    // Container only. Runtime boots by finding [data-json-url].
    return '<div class="bcs-mag mag-plug" data-json-url="' . esc_attr($json_url) . '" data-config="' . $cfg_attr . '"></div>';
  }

  public static function dequeue_legacy_assets() {
    // These are safe no-ops if not present; adjust if you know exact legacy handles.
    $handles = [
      'magazine-plug', 'magazine-plug-runtime', 'magazine_plug_runtime',
      'mag-plug-runtime', 'mag-plug', 'mag_plug',
      'turnjs', 'turn-js', 'flipbook', 'flipbook-runtime',
      'bcs-magazine', 'bcs-magazine-runtime-legacy',
    ];

    foreach ($handles as $h) {
      wp_dequeue_script($h);
      wp_deregister_script($h);
      wp_dequeue_style($h);
      wp_deregister_style($h);
    }
  }
}

BCS_Magazine_Custom_Layer::init();
