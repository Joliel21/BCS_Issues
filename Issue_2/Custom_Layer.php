<?php 
/**
 * Plugin Name: BCS Magazine Custom Layer
 * Description: Dequeues base magazine runtime assets and loads a late custom CSS/JS layer from remote URLs. Includes optional inline lock patch + knob rescue.
 * Version: 1.2.0
 * Author: BCS
 */

if (!defined('ABSPATH')) exit;

define('BCS_MCL_OPT', 'bcs_mcl_options');

function bcs_mcl_defaults() {
  return array(
    'css_url' => '',
    'js_url'  => '',
    'ver'     => '1767974732',

    // All inline patches are scoped to this selector.
    'scope_selector' => '.mag-plug',

    // Base runtime handles to dequeue (defaults match what you described).
    'base_script_handle' => 'mag-plug-runtime',
    'base_style_handle'  => 'mag-plug-runtime',

    // Debug badge to prove the layer is active.
    'show_marker' => '1',

    // Inline "lock motion" patch to stop flying. Appended last so it wins.
    'inject_lock_patch' => '1',

    // Allow knob rotation while keeping all other motion disabled.
    'allow_knob_rotation' => '1',
  );
}

function bcs_mcl_get_opts() {
  $opts = get_option(BCS_MCL_OPT, array());
  $opts = is_array($opts) ? $opts : array();
  return array_merge(bcs_mcl_defaults(), $opts);
}

function bcs_mcl_save_opts($new) {
  $opts = bcs_mcl_get_opts();
  foreach ($new as $k => $v) {
    if (!array_key_exists($k, $opts)) continue;
    $opts[$k] = is_string($v) ? trim($v) : $v;
  }
  update_option(BCS_MCL_OPT, $opts, false);
}

function bcs_mcl_is_valid_url($u) {
  if (!$u) return false;
  return (bool) filter_var($u, FILTER_VALIDATE_URL);
}

function bcs_mcl_add_ver($url, $ver) {
  return add_query_arg('ver', $ver, $url);
}

/**
 * Inline CSS patch:
 * - disables 3D/parallax vars
 * - hard-locks background
 * - optionally allows ONLY knob rotation on Z axis
 */
function bcs_mcl_lock_patch_css($scope, $allow_knob_rotation = true) {
  $scope = $scope ? $scope : '.mag-plug';

  $bookTransform = $allow_knob_rotation
    ? 'transform: rotateZ(var(--mag-tilt-z)) !important; transition: transform 120ms ease !important; will-change: transform !important;'
    : 'transform: none !important; transition: none !important; will-change: auto !important;';

  return "
/* =====================================================================
   BCS MCL — INLINE LOCK PATCH (stops flying + background motion)
   ===================================================================== */
{$scope},
{$scope} .mag-plug-wrapper,
{$scope} .mag-plug-stage,
{$scope} .mag-plug-object{
  --mag-tilt-x: 0deg !important;
  --mag-tilt-y: 0deg !important;
  --mag-parallax-z: 0px !important;
  --mag-parallax-scale: 1 !important;
  --mag-bg-x: 0px !important;
  --mag-bg-y: 0px !important;
  --mag-bg-scale: 1 !important;
}

/* Background: force static center + no transforms */
{$scope} .mag-plug-background{
  background-position: 50% 50% !important;
  transform: none !important;
  will-change: auto !important;
}

/* Stage: remove perspective */
{$scope} .mag-plug-stage{
  perspective: none !important;
  perspective-origin: 50% 50% !important;
}

/* Book/object: remove tilt+z motion; optionally allow ONLY knob rotation */
{$scope} .mag-plug-object{
  {$bookTransform}
  transform-style: flat !important;
}

/* Defensive: no animation sneaking in */
@media (prefers-reduced-motion: no-preference){
  {$scope} .mag-plug-object,
  {$scope} .mag-plug-background{
    animation: none !important;
  }
}
";
}

function bcs_mcl_marker_css($scope) {
  $scope = $scope ? $scope : '.mag-plug';
  return $scope . '::before{content:"CUSTOM LAYER ACTIVE";position:fixed;top:10px;right:10px;z-index:2147483647;padding:8px 12px;background:#0a7;color:#fff;font:700 12px/1.2 system-ui;border-radius:999px;pointer-events:none;}';
}

/**
 * Inline JS: knob menu toggle + rotation var updates
 */
function bcs_mcl_knob_rescue_js() {
  return <<<JS
(function(){
  function q(sel, root){ return (root||document).querySelector(sel); }
  function qa(sel, root){ return Array.prototype.slice.call((root||document).querySelectorAll(sel)); }

  function bootOne(root){
    var wrapper = q(".mag-plug-wrapper", root) || root;
    var knobBtn = q(".mag-plug-knob", wrapper);
    var menu = q(".mag-plug-knob-menu", wrapper);
    if(!knobBtn || !menu) return;

    if(knobBtn.__bcsKnobBound) return;
    knobBtn.__bcsKnobBound = true;

    var open = false;
    function setOpen(v){
      open = !!v;
      if(open) menu.classList.add("is-open"); else menu.classList.remove("is-open");
      knobBtn.setAttribute("aria-expanded", open ? "true" : "false");
    }

    knobBtn.addEventListener("click", function(e){
      e.preventDefault();
      e.stopPropagation();
      setOpen(!open);
    }, true);

    document.addEventListener("click", function(e){
      if(!open) return;
      if(menu.contains(e.target) || knobBtn.contains(e.target)) return;
      setOpen(false);
    }, true);

    document.addEventListener("keydown", function(e){
      if(e.key === "Escape") setOpen(false);
    }, true);

    function getRot(){
      var v = getComputedStyle(root).getPropertyValue("--mag-tilt-z") || "0deg";
      var n = parseFloat(String(v).replace("deg","")) || 0;
      return n;
    }
    function setRot(deg){
      root.style.setProperty("--mag-tilt-z", String(deg) + "deg");
    }

    menu.addEventListener("click", function(e){
      var t = e.target;
      if(!t || !t.getAttribute) return;
      var act = t.getAttribute("data-action");
      if(!act) return;

      e.preventDefault();
      e.stopPropagation();
      setOpen(false);

      var rot = getRot();
      if(act === "center") { setRot(0); return; }
      if(act === "rot-45") setRot(rot - 45);
      if(act === "rot+45") setRot(rot + 45);
      if(act === "rot-90") setRot(rot - 90);
      if(act === "rot+90") setRot(rot + 90);
    }, true);
  }

  function bootAll(){ qa(".mag-plug").forEach(bootOne); }

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootAll);
  else bootAll();
})();
JS;
}

/**
 * A) Block base runtime completely (most reliable):
 * Dequeue AFTER it has been enqueued. Run very late.
 */
add_action('wp_print_scripts', function() {
  $o = bcs_mcl_get_opts();
  $h = trim((string)($o['base_script_handle'] ?? ''));
  if ($h) {
    wp_dequeue_script($h);
    wp_deregister_script($h);
  }
}, 100000);

add_action('wp_print_styles', function() {
  $o = bcs_mcl_get_opts();
  $h = trim((string)($o['base_style_handle'] ?? ''));
  if ($h) {
    wp_dequeue_style($h);
    wp_deregister_style($h);
  }
}, 100000);

/**
 * Enqueue our layer extremely late so it wins.
 */
add_action('wp_enqueue_scripts', function() {
  $o = bcs_mcl_get_opts();
  $ver = $o['ver'];

  $scope = trim((string)($o['scope_selector'] ?? '.mag-plug'));
  if (!$scope) $scope = '.mag-plug';

  $handle_style  = 'bcs-magazine-custom-layer-style';
  $handle_script = 'bcs-magazine-custom-layer-script';

  // CSS
  if (bcs_mcl_is_valid_url($o['css_url'])) {
    wp_enqueue_style($handle_style, bcs_mcl_add_ver($o['css_url'], $ver), array(), null);
  } else {
    wp_register_style($handle_style, false, array(), null);
    wp_enqueue_style($handle_style);
  }

  if (!empty($o['show_marker']) && $o['show_marker'] !== '0') {
    wp_add_inline_style($handle_style, bcs_mcl_marker_css($scope));
  }

  if (!empty($o['inject_lock_patch']) && $o['inject_lock_patch'] !== '0') {
    $allowKnob = (!empty($o['allow_knob_rotation']) && $o['allow_knob_rotation'] !== '0');
    wp_add_inline_style($handle_style, bcs_mcl_lock_patch_css($scope, $allowKnob));
  }

  // JS
  if (bcs_mcl_is_valid_url($o['js_url'])) {
    wp_enqueue_script($handle_script, bcs_mcl_add_ver($o['js_url'], $ver), array(), null, true);
    wp_add_inline_script($handle_script, bcs_mcl_knob_rescue_js(), 'after');
  }
}, 100000);

/**
 * Admin settings
 */
add_action('admin_menu', function() {
  add_options_page(
    'BCS Magazine Custom Layer',
    'BCS Magazine Custom Layer',
    'manage_options',
    'bcs-magazine-custom-layer',
    'bcs_mcl_render_settings'
  );
});

add_action('admin_init', function() {
  if (!current_user_can('manage_options')) return;

  if (isset($_POST['bcs_mcl_save']) && check_admin_referer('bcs_mcl_save_action', 'bcs_mcl_nonce')) {
    bcs_mcl_save_opts(array(
      'css_url' => $_POST['css_url'] ?? '',
      'js_url'  => $_POST['js_url'] ?? '',
      'ver'     => $_POST['ver'] ?? '',
      'scope_selector' => $_POST['scope_selector'] ?? '.mag-plug',
      'base_script_handle' => $_POST['base_script_handle'] ?? 'mag-plug-runtime',
      'base_style_handle'  => $_POST['base_style_handle'] ?? 'mag-plug-runtime',
      'show_marker' => $_POST['show_marker'] ?? '1',
      'inject_lock_patch' => $_POST['inject_lock_patch'] ?? '1',
      'allow_knob_rotation' => $_POST['allow_knob_rotation'] ?? '1',
    ));
    add_settings_error('bcs_mcl_messages', 'bcs_mcl_saved', 'Saved.', 'updated');
  }

  if (isset($_POST['bcs_mcl_bump']) && check_admin_referer('bcs_mcl_save_action', 'bcs_mcl_nonce')) {
    $o = bcs_mcl_get_opts();
    $o['ver'] = (string) time();
    update_option(BCS_MCL_OPT, $o, false);
    add_settings_error('bcs_mcl_messages', 'bcs_mcl_bumped', 'Version bumped (cache-bust).', 'updated');
  }
});

function bcs_mcl_render_settings() {
  $o = bcs_mcl_get_opts();
  settings_errors('bcs_mcl_messages');
  ?>
  <div class="wrap">
    <h1>BCS Magazine Custom Layer</h1>

    <form method="post">
      <?php wp_nonce_field('bcs_mcl_save_action', 'bcs_mcl_nonce'); ?>

      <table class="form-table" role="presentation">
        <tr>
          <th scope="row"><label for="css_url">Custom CSS URL (remote)</label></th>
          <td><input name="css_url" id="css_url" type="url" class="regular-text" value="<?php echo esc_attr($o['css_url']); ?>" placeholder="https://cdn.jsdelivr.net/gh/.../magazine.css" /></td>
        </tr>
        <tr>
          <th scope="row"><label for="js_url">Custom JS URL (remote)</label></th>
          <td><input name="js_url" id="js_url" type="url" class="regular-text" value="<?php echo esc_attr($o['js_url']); ?>" placeholder="https://cdn.jsdelivr.net/gh/.../magazine.js" /></td>
        </tr>

        <tr>
          <th scope="row"><label for="scope_selector">Scope selector</label></th>
          <td>
            <input name="scope_selector" id="scope_selector" type="text" class="regular-text" value="<?php echo esc_attr($o['scope_selector']); ?>" />
            <p class="description">All inline patches are scoped to this selector. Default: <code>.mag-plug</code>.</p>
          </td>
        </tr>

        <tr>
          <th scope="row"><label for="base_script_handle">Base runtime JS handle to dequeue</label></th>
          <td>
            <input name="base_script_handle" id="base_script_handle" type="text" class="regular-text" value="<?php echo esc_attr($o['base_script_handle']); ?>" />
            <p class="description">Default: <code>mag-plug-runtime</code>.</p>
          </td>
        </tr>

        <tr>
          <th scope="row"><label for="base_style_handle">Base runtime CSS handle to dequeue</label></th>
          <td>
            <input name="base_style_handle" id="base_style_handle" type="text" class="regular-text" value="<?php echo esc_attr($o['base_style_handle']); ?>" />
            <p class="description">Default: <code>mag-plug-runtime</code>.</p>
          </td>
        </tr>

        <tr>
          <th scope="row">Options</th>
          <td>
            <label>
              <input type="checkbox" name="show_marker" value="1" <?php checked($o['show_marker'], '1'); ?> />
              Show “CUSTOM LAYER ACTIVE” badge
            </label>
            <br />
            <label>
              <input type="checkbox" name="inject_lock_patch" value="1" <?php checked($o['inject_lock_patch'], '1'); ?> />
              Inject lock patch to stop “flying”
            </label>
            <br />
            <label>
              <input type="checkbox" name="allow_knob_rotation" value="1" <?php checked($o['allow_knob_rotation'], '1'); ?> />
              Allow knob rotation (Z axis) while locked
            </label>
          </td>
        </tr>

        <tr>
          <th scope="row"><label for="ver">Version (cache-bust)</label></th>
          <td>
            <input name="ver" id="ver" type="text" class="regular-text" value="<?php echo esc_attr($o['ver']); ?>" />
          </td>
        </tr>
      </table>

      <p class="submit">
        <button type="submit" name="bcs_mcl_save" class="button button-primary">Save</button>
        <button type="submit" name="bcs_mcl_bump" class="button">Bump Version</button>
      </p>
    </form>
  </div>
  <?php
}
