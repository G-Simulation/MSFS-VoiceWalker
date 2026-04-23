<?php
/**
 * Plugin Name:       G-Sim Events (MSFSVoiceWalker)
 * Description:       Event-Hosting-Plattform für MSFSVoiceWalker. Ermöglicht Veranstaltern, öffentliche Fly-Ins / Air-Races / Formation-Flights anzulegen, Tickets zu verkaufen (via WooCommerce) und Teilnehmer mit Join-Link/Passphrase zu versorgen. Ersatz für Event Tickets Plus (rein kostenlos).
 * Version:           0.1.0
 * Author:            G-Simulation
 * Author URI:        https://www.gsimulations.de
 * License:           Apache-2.0
 * Text Domain:       gsim-events
 * Requires Plugins:  woocommerce, the-events-calendar
 */

if (!defined('ABSPATH')) exit;

define('GSIM_EVENTS_VERSION',     '0.1.0');
define('GSIM_EVENTS_APP_URL',     'http://127.0.0.1:7801');      // Local-App-Join-URL (Browser des Teilnehmers)
define('GSIM_EVENTS_PASS_SALT',   'msfsvoicewalker-private-v1'); // MUSS mit web/app.js::PRIVATE_ROOM_SALT matchen
define('GSIM_EVENTS_ROLE',        'event_organizer');
define('GSIM_EVENTS_CPT_ATTENDEE','gsim_event_attendee');

// Product-Meta-Key: verknüpft WC-Produkt mit tribe_events-Post
define('GSIM_EVENTS_META_TICKET_EVENT', '_gsim_ticket_event_id');
// Event-Meta-Keys: auto-generiert beim Save
define('GSIM_EVENTS_META_PASSPHRASE',   '_gsim_event_passphrase');
define('GSIM_EVENTS_META_JOIN_URL',     '_gsim_event_join_url');

// WC-Produkt-ID des "Fly-In Event Hosting"-Produkts. Beim Kauf dieses Produkts
// wird der Käufer zum event_organizer. Kann via Filter überschrieben werden.
function gsim_events_hosting_product_id() {
    return (int) apply_filters('gsim_events_hosting_product_id', 975);
}

// -----------------------------------------------------------------------------
// Aktivierung / Deaktivierung
// -----------------------------------------------------------------------------

register_activation_hook(__FILE__, function () {
    // Rolle anlegen mit Rechten für Events + eigene Attendees (nur eigene!)
    if (!get_role(GSIM_EVENTS_ROLE)) {
        add_role(GSIM_EVENTS_ROLE, 'Event Organizer', [
            'read'                          => true,
            'upload_files'                  => true,
            // tribe_events Capabilities
            'edit_tribe_events'             => true,
            'edit_published_tribe_events'   => true,
            'publish_tribe_events'          => true,
            'delete_tribe_events'           => true,
            'edit_tribe_venues'             => true,
            'publish_tribe_venues'          => true,
            'edit_tribe_organizers'         => true,
            'publish_tribe_organizers'      => true,
            // eigene Attendee-Listen lesen
            'edit_' . GSIM_EVENTS_CPT_ATTENDEE . 's'         => true,
            'read_' . GSIM_EVENTS_CPT_ATTENDEE               => true,
        ]);
    }
    // CPT-Flush damit Permalinks greifen
    gsim_events_register_attendee_cpt();
    flush_rewrite_rules();
});

register_deactivation_hook(__FILE__, function () {
    flush_rewrite_rules();
    // Rolle absichtlich NICHT entfernen — sonst verlieren bestehende Veranstalter ihre Rechte bei Update-Problemen.
});

// -----------------------------------------------------------------------------
// Custom Post Type: Attendee (Teilnehmer-Datensatz pro Ticket-Kauf)
// -----------------------------------------------------------------------------

function gsim_events_register_attendee_cpt() {
    register_post_type(GSIM_EVENTS_CPT_ATTENDEE, [
        'labels' => [
            'name'          => 'Event-Teilnehmer',
            'singular_name' => 'Teilnehmer',
            'menu_name'     => 'Teilnehmer',
        ],
        'public'       => false,
        'show_ui'      => true,
        'show_in_menu' => 'edit.php?post_type=tribe_events',
        'supports'     => ['title', 'custom-fields'],
        'capability_type' => GSIM_EVENTS_CPT_ATTENDEE,
        'map_meta_cap'    => true,
        'show_in_rest'    => false,
    ]);
}
add_action('init', 'gsim_events_register_attendee_cpt');

// -----------------------------------------------------------------------------
// Event-Save-Hook: Passphrase + Join-URL automatisch generieren
// -----------------------------------------------------------------------------

add_action('save_post_tribe_events', function ($post_id, $post, $update) {
    // Kein Auto-Save / Revision
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) return;
    if (wp_is_post_revision($post_id))               return;
    if ($post->post_status === 'auto-draft')         return;

    $pass = get_post_meta($post_id, GSIM_EVENTS_META_PASSPHRASE, true);
    if (empty($pass)) {
        // Passphrase: "flyin-<slug>-<6-hex>" — menschenlesbar + unique genug
        $slug = sanitize_title($post->post_title ?: 'event');
        $slug = substr($slug, 0, 24);
        $suffix = wp_generate_password(6, false, false);
        $pass = 'flyin-' . $slug . '-' . strtolower($suffix);
        update_post_meta($post_id, GSIM_EVENTS_META_PASSPHRASE, $pass);
    }
    $join = GSIM_EVENTS_APP_URL . '/?join=' . rawurlencode($pass);
    update_post_meta($post_id, GSIM_EVENTS_META_JOIN_URL, $join);
}, 10, 3);

// -----------------------------------------------------------------------------
// Admin-UI: Meta-Box "MSFSVoiceWalker Event-Details" auf tribe_events
// -----------------------------------------------------------------------------

add_action('add_meta_boxes_tribe_events', function () {
    add_meta_box(
        'gsim_events_voicewalker',
        'MSFSVoiceWalker — Event-Details',
        function ($post) {
            $pass = get_post_meta($post->ID, GSIM_EVENTS_META_PASSPHRASE, true);
            $join = get_post_meta($post->ID, GSIM_EVENTS_META_JOIN_URL, true);
            ?>
            <p><strong>Passphrase</strong> (auto-generiert, wird beim ersten Speichern gesetzt):<br>
               <code><?php echo esc_html($pass ?: '—'); ?></code></p>
            <p><strong>Direkt-Join-Link</strong> — dieser Link landet im PDF-Briefing und in der Event-Ankündigung:<br>
               <code><?php echo esc_html($join ?: '—'); ?></code></p>
            <p style="color:#888;font-size:12px">
               Teilnehmer klickt auf den Link → MSFSVoiceWalker-App öffnet sich → tritt automatisch dem privaten Raum bei.
               Voraussetzung: Teilnehmer hat Pro (oder Event-Gast-Code, später).
            </p>
            <?php
        },
        'tribe_events',
        'side',
        'default'
    );
});

// -----------------------------------------------------------------------------
// WC-Produkt: Meta-Feld "Verknüpft mit Event" (verwandelt Produkt in "Ticket")
// -----------------------------------------------------------------------------

add_action('woocommerce_product_options_general_product_data', function () {
    global $post;
    // Alle zukünftigen + vergangenen Events als Dropdown
    $events = get_posts([
        'post_type'   => 'tribe_events',
        'numberposts' => 200,
        'post_status' => ['publish', 'draft', 'future'],
        'orderby'     => 'date',
        'order'       => 'DESC',
    ]);
    $current = get_post_meta($post->ID, GSIM_EVENTS_META_TICKET_EVENT, true);
    echo '<div class="options_group">';
    woocommerce_wp_select([
        'id'          => GSIM_EVENTS_META_TICKET_EVENT,
        'label'       => 'MSFSVoiceWalker: Event-Ticket für',
        'description' => 'Mache dieses Produkt zu einem Ticket für ein bestimmtes Event. Beim Kauf bekommt der Teilnehmer automatisch Join-Link + Passphrase per Mail.',
        'desc_tip'    => true,
        'options'     => array_merge(
            ['' => '— kein Event (normales Produkt) —'],
            array_reduce($events, function ($acc, $e) {
                $acc[$e->ID] = sprintf('#%d — %s', $e->ID, $e->post_title);
                return $acc;
            }, [])
        ),
        'value'       => $current,
    ]);
    echo '</div>';
});

add_action('woocommerce_process_product_meta', function ($post_id) {
    $val = isset($_POST[GSIM_EVENTS_META_TICKET_EVENT]) ? sanitize_text_field($_POST[GSIM_EVENTS_META_TICKET_EVENT]) : '';
    update_post_meta($post_id, GSIM_EVENTS_META_TICKET_EVENT, $val);
});

// -----------------------------------------------------------------------------
// WC Order completed: Käufer des Hosting-Produkts → event_organizer-Rolle
// -----------------------------------------------------------------------------

add_action('woocommerce_order_status_completed', function ($order_id) {
    $order = wc_get_order($order_id);
    if (!$order) return;
    $hosting_id = gsim_events_hosting_product_id();

    $buys_hosting = false;
    foreach ($order->get_items() as $item) {
        if ((int) $item->get_product_id() === $hosting_id) {
            $buys_hosting = true;
            break;
        }
    }
    if (!$buys_hosting) return;

    // User finden oder anlegen
    $email = $order->get_billing_email();
    if (!$email) return;
    $user  = get_user_by('email', $email);
    if (!$user) {
        $name = trim($order->get_billing_first_name() . ' ' . $order->get_billing_last_name());
        $login = sanitize_user(
            strtolower(($name ?: explode('@', $email)[0]) . wp_generate_password(3, false)),
            true
        );
        $pass = wp_generate_password(16, true);
        $user_id = wp_create_user($login, $pass, $email);
        if (is_wp_error($user_id)) return;
        wp_update_user(['ID' => $user_id, 'display_name' => $name ?: $login, 'role' => GSIM_EVENTS_ROLE]);
        // Passwort-Reset-Link zum Login schicken
        $reset_key = get_password_reset_key(get_user_by('id', $user_id));
        $login_url = network_site_url("wp-login.php?action=rp&key=$reset_key&login=" . rawurlencode($login), 'login');
        wp_mail($email,
            'Willkommen als MSFSVoiceWalker Event-Organizer',
            "Hallo,\n\n"
            . "danke für den Kauf des Event-Hosting-Pakets.\n\n"
            . "Dein Veranstalter-Account wurde erstellt:\n"
            . "  Login: $login\n"
            . "  Passwort festlegen: $login_url\n\n"
            . "Nach dem Einloggen siehst du im WP-Dashboard einen neuen Menüpunkt 'Veranstaltungen'.\n"
            . "Dort kannst du Events anlegen, Tickets erzeugen und Teilnehmerlisten einsehen.\n\n"
            . "Schnellstart-Guide: " . home_url('/veranstalter-dashboard') . "\n\n"
            . "— G-Simulation"
        );
    } else {
        $u = new WP_User($user->ID);
        if (!in_array(GSIM_EVENTS_ROLE, (array) $u->roles)) {
            $u->add_role(GSIM_EVENTS_ROLE);
            wp_mail($email,
                'Du kannst jetzt Events auf MSFSVoiceWalker veranstalten',
                "Hallo " . ($user->display_name ?: $user->user_login) . ",\n\n"
                . "dein Account wurde soeben als Event-Organizer freigeschaltet.\n"
                . "Nach dem nächsten Login siehst du im Dashboard den Menüpunkt 'Veranstaltungen'.\n\n"
                . "Dashboard: " . home_url('/veranstalter-dashboard') . "\n\n"
                . "— G-Simulation"
            );
        }
    }
}, 20);

// -----------------------------------------------------------------------------
// WC Order completed: Attendee-Datensatz anlegen + Mail mit Join-Link
// -----------------------------------------------------------------------------

add_action('woocommerce_order_status_completed', function ($order_id) {
    $order = wc_get_order($order_id);
    if (!$order) return;

    foreach ($order->get_items() as $item) {
        $product_id = $item->get_product_id();
        $event_id   = (int) get_post_meta($product_id, GSIM_EVENTS_META_TICKET_EVENT, true);
        if (!$event_id) continue;

        $event = get_post($event_id);
        if (!$event || $event->post_type !== 'tribe_events') continue;

        $pass = get_post_meta($event_id, GSIM_EVENTS_META_PASSPHRASE, true);
        $join = get_post_meta($event_id, GSIM_EVENTS_META_JOIN_URL, true);
        $customer_email = $order->get_billing_email();
        $customer_name  = trim($order->get_billing_first_name() . ' ' . $order->get_billing_last_name());

        // Attendee-Post anlegen (1 pro Ticket-Item)
        $qty = max(1, (int) $item->get_quantity());
        for ($i = 0; $i < $qty; $i++) {
            $attendee_id = wp_insert_post([
                'post_type'   => GSIM_EVENTS_CPT_ATTENDEE,
                'post_status' => 'publish',
                'post_title'  => sprintf('%s — %s', $event->post_title, $customer_name ?: $customer_email),
                'meta_input'  => [
                    '_event_id'      => $event_id,
                    '_order_id'      => $order_id,
                    '_product_id'    => $product_id,
                    '_attendee_name' => $customer_name,
                    '_attendee_email'=> $customer_email,
                    '_passphrase'    => $pass,
                    '_join_url'      => $join,
                ],
            ]);
        }

        // Mail an Teilnehmer
        $subject = sprintf('Dein Ticket: %s', $event->post_title);
        $event_date = tribe_get_start_date($event_id, true, 'd.m.Y H:i') ?: '—';
        $body = sprintf(
            "Hallo %s,\n\n"
            . "danke für deine Anmeldung zu \"%s\" (%s).\n\n"
            . "SO KOMMST DU INS EVENT:\n"
            . "1) MSFSVoiceWalker installieren: https://www.gsimulations.de/msfsvoicewalker\n"
            . "2) App starten\n"
            . "3) Diesen Link im Browser öffnen (App muss laufen):\n"
            . "   %s\n\n"
            . "Alternativ: Passphrase \"%s\" manuell unter 'Privater Raum' eintragen.\n\n"
            . "Viel Spaß beim Fliegen!\n"
            . "— G-Simulation",
            $customer_name ?: 'Pilot',
            $event->post_title,
            $event_date,
            $join,
            $pass
        );
        wp_mail($customer_email, $subject, $body);
    }
});

// -----------------------------------------------------------------------------
// Shortcode: [gsim_event_tickets event="123"]
// Rendert auf der Event-Seite die verknüpften Ticket-Produkte als Kauf-Buttons.
// -----------------------------------------------------------------------------

add_shortcode('gsim_event_tickets', function ($atts) {
    $atts = shortcode_atts(['event' => 0], $atts);
    $event_id = (int) $atts['event'];
    if (!$event_id) {
        // Fallback: aktuelle Loop-Post-ID nehmen
        $event_id = get_the_ID();
    }
    if (!$event_id) return '';

    // Alle Produkte finden die dieses Event als Ticket-Target haben
    $products = get_posts([
        'post_type'   => 'product',
        'numberposts' => 20,
        'meta_key'    => GSIM_EVENTS_META_TICKET_EVENT,
        'meta_value'  => $event_id,
        'post_status' => 'publish',
    ]);
    if (empty($products)) {
        return '<p><em>Dieses Event hat noch keine Tickets im Verkauf.</em></p>';
    }
    ob_start();
    echo '<div class="gsim-event-tickets" style="display:grid;gap:12px;margin:20px 0">';
    foreach ($products as $p) {
        $wc_product = wc_get_product($p->ID);
        if (!$wc_product) continue;
        $price = $wc_product->get_price_html();
        $stock = $wc_product->is_in_stock() ? ($wc_product->get_stock_quantity() ?: '∞') : 'ausverkauft';
        $url   = '/?add-to-cart=' . $p->ID;
        printf(
            '<div style="border:1px solid #ddd;padding:16px;border-radius:8px"><h4 style="margin:0 0 6px 0">%s</h4><p style="margin:0 0 10px 0">%s · Kapazität: %s</p>%s<a href="%s" class="button" style="background:#2f5cff;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none">Ticket kaufen</a></div>',
            esc_html($p->post_title),
            $price,
            esc_html($stock),
            wp_kses_post($wc_product->get_short_description()),
            esc_url($url)
        );
    }
    echo '</div>';
    return ob_get_clean();
});

// -----------------------------------------------------------------------------
// Public REST API — /wp-json/gsim-events/v1/
//
//   GET    /events                      List published events (paginated)
//   GET    /events/{id}                 Single event with passphrase + tickets
//   POST   /events                      Create event (organizer auth required)
//   PUT    /events/{id}                 Update own event (organizer auth)
//   DELETE /events/{id}                 Delete own event (organizer auth)
//   GET    /events/{id}/attendees       List attendees (own events + admin only)
//   POST   /events/{id}/tickets         Create a ticket (WC product) for event
//
// Auth: Application-Passwords (Basic Auth) for write endpoints. Read is public.
// -----------------------------------------------------------------------------

function gsim_events_shape_event($event) {
    $start = function_exists('tribe_get_start_date') ? tribe_get_start_date($event->ID, true, 'c') : null;
    $end   = function_exists('tribe_get_end_date')   ? tribe_get_end_date($event->ID, true, 'c')   : null;
    // Tickets (WC products linked to this event)
    $ticket_products = get_posts([
        'post_type'   => 'product',
        'numberposts' => 20,
        'meta_key'    => GSIM_EVENTS_META_TICKET_EVENT,
        'meta_value'  => $event->ID,
        'post_status' => 'publish',
    ]);
    $tickets = [];
    foreach ($ticket_products as $p) {
        $w = wc_get_product($p->ID);
        if (!$w) continue;
        $tickets[] = [
            'id'          => $p->ID,
            'name'        => $p->post_title,
            'price'       => (float) $w->get_price(),
            'currency'    => get_woocommerce_currency(),
            'stock'       => $w->get_stock_quantity(),
            'in_stock'    => $w->is_in_stock(),
            'purchase_url'=> wc_get_checkout_url() . '?add-to-cart=' . $p->ID,
        ];
    }
    $attendee_count = (int) (new WP_Query([
        'post_type'   => GSIM_EVENTS_CPT_ATTENDEE,
        'meta_key'    => '_event_id',
        'meta_value'  => $event->ID,
        'post_status' => 'publish',
        'fields'      => 'ids',
        'nopaging'    => true,
    ]))->found_posts;
    return [
        'id'             => $event->ID,
        'title'          => $event->post_title,
        'slug'           => $event->post_name,
        'description'    => wp_strip_all_tags($event->post_content),
        'description_html'=> apply_filters('the_content', $event->post_content),
        'status'         => $event->post_status,
        'author_id'      => (int) $event->post_author,
        'start'          => $start,
        'end'            => $end,
        'passphrase'     => get_post_meta($event->ID, GSIM_EVENTS_META_PASSPHRASE, true),
        'join_url'       => get_post_meta($event->ID, GSIM_EVENTS_META_JOIN_URL, true),
        'tickets'        => $tickets,
        'attendee_count' => $attendee_count,
        'url'            => get_permalink($event->ID),
    ];
}

function gsim_events_require_organizer($req) {
    if (!is_user_logged_in()) {
        return new WP_Error('rest_forbidden', 'Login erforderlich', ['status' => 401]);
    }
    $user = wp_get_current_user();
    if (!in_array(GSIM_EVENTS_ROLE, (array) $user->roles) && !user_can($user, 'manage_options')) {
        return new WP_Error('rest_forbidden', 'Event-Organizer-Rolle erforderlich', ['status' => 403]);
    }
    return true;
}

add_action('rest_api_init', function () {
    $ns = 'gsim-events/v1';

    // GET /events — Liste öffentlicher Events
    register_rest_route($ns, '/events', [
        'methods'  => 'GET',
        'callback' => function ($req) {
            $args = [
                'post_type'   => 'tribe_events',
                'post_status' => 'publish',
                'numberposts' => min(50, (int) ($req['per_page'] ?? 20)),
                'offset'      => max(0, (int) ($req['offset'] ?? 0)),
                'orderby'     => 'meta_value',
                'meta_key'    => '_EventStartDate',
                'order'       => 'ASC',
            ];
            // Nur zukünftige Events wenn ?upcoming=1
            if (!empty($req['upcoming'])) {
                $args['meta_query'] = [[
                    'key'     => '_EventStartDate',
                    'value'   => current_time('mysql'),
                    'compare' => '>=',
                    'type'    => 'DATETIME',
                ]];
            }
            $events = get_posts($args);
            return array_map('gsim_events_shape_event', $events);
        },
        'permission_callback' => '__return_true',
        'args' => [
            'per_page' => ['type' => 'integer', 'default' => 20],
            'offset'   => ['type' => 'integer', 'default' => 0],
            'upcoming' => ['type' => 'boolean', 'default' => false],
        ],
    ]);

    // GET /events/{id}
    register_rest_route($ns, '/events/(?P<id>\d+)', [
        'methods'  => 'GET',
        'callback' => function ($req) {
            $id = (int) $req['id'];
            $event = get_post($id);
            if (!$event || $event->post_type !== 'tribe_events' || $event->post_status !== 'publish') {
                return new WP_Error('not_found', 'Event nicht gefunden', ['status' => 404]);
            }
            return gsim_events_shape_event($event);
        },
        'permission_callback' => '__return_true',
    ]);

    // POST /events — Event anlegen (via TEC's tribe_create_event, damit
    // alle internen Rewrites / Taxonomien / Meta korrekt gesetzt werden).
    register_rest_route($ns, '/events', [
        'methods'  => 'POST',
        'callback' => function ($req) {
            $user_id = get_current_user_id();
            if (!function_exists('tribe_create_event')) {
                return new WP_Error('tec_missing', 'The Events Calendar muss aktiv sein', ['status' => 500]);
            }
            $start = !empty($req['start']) ? date('Y-m-d H:i:s', strtotime($req['start'])) : date('Y-m-d H:i:s');
            $end   = !empty($req['end'])   ? date('Y-m-d H:i:s', strtotime($req['end']))   : date('Y-m-d H:i:s', strtotime('+2 hours'));
            $event_id = tribe_create_event([
                'post_title'   => sanitize_text_field($req['title'] ?? 'Untitled Event'),
                'post_content' => wp_kses_post($req['description'] ?? ''),
                'post_status'  => sanitize_text_field($req['status'] ?? 'draft'),
                'post_author'  => $user_id,
                'EventStartDate' => $start,
                'EventEndDate'   => $end,
                'EventAllDay'    => false,
                'EventTimezone'  => wp_timezone_string(),
            ]);
            if (!$event_id || is_wp_error($event_id)) {
                return new WP_Error('create_failed', 'Event konnte nicht erstellt werden', ['status' => 500]);
            }
            // Passphrase wird durch save_post_tribe_events-Hook automatisch generiert
            return gsim_events_shape_event(get_post($event_id));
        },
        'permission_callback' => 'gsim_events_require_organizer',
        'args' => [
            'title'       => ['type' => 'string', 'required' => true],
            'description' => ['type' => 'string'],
            'start'       => ['type' => 'string', 'description' => 'ISO-8601'],
            'end'         => ['type' => 'string', 'description' => 'ISO-8601'],
            'status'      => ['type' => 'string', 'default' => 'draft', 'enum' => ['draft','publish']],
        ],
    ]);

    // PUT /events/{id}
    register_rest_route($ns, '/events/(?P<id>\d+)', [
        'methods'  => 'PUT',
        'callback' => function ($req) {
            $id = (int) $req['id'];
            $event = get_post($id);
            if (!$event || $event->post_type !== 'tribe_events') {
                return new WP_Error('not_found', 'Event nicht gefunden', ['status' => 404]);
            }
            $user_id = get_current_user_id();
            if ($event->post_author != $user_id && !user_can($user_id, 'manage_options')) {
                return new WP_Error('rest_forbidden', 'Nur eigene Events editierbar', ['status' => 403]);
            }
            $update = ['ID' => $id];
            if (isset($req['title']))       $update['post_title']   = sanitize_text_field($req['title']);
            if (isset($req['description'])) $update['post_content'] = wp_kses_post($req['description']);
            if (isset($req['status']))      $update['post_status']  = sanitize_text_field($req['status']);
            wp_update_post($update);
            if (isset($req['start']))       update_post_meta($id, '_EventStartDate', date('Y-m-d H:i:s', strtotime($req['start'])));
            if (isset($req['end']))         update_post_meta($id, '_EventEndDate',   date('Y-m-d H:i:s', strtotime($req['end'])));
            return gsim_events_shape_event(get_post($id));
        },
        'permission_callback' => 'gsim_events_require_organizer',
    ]);

    // DELETE /events/{id}
    register_rest_route($ns, '/events/(?P<id>\d+)', [
        'methods'  => 'DELETE',
        'callback' => function ($req) {
            $id = (int) $req['id'];
            $event = get_post($id);
            if (!$event || $event->post_type !== 'tribe_events') {
                return new WP_Error('not_found', 'Event nicht gefunden', ['status' => 404]);
            }
            $user_id = get_current_user_id();
            if ($event->post_author != $user_id && !user_can($user_id, 'manage_options')) {
                return new WP_Error('rest_forbidden', 'Nur eigene Events löschbar', ['status' => 403]);
            }
            wp_delete_post($id, true);
            return ['deleted' => true, 'id' => $id];
        },
        'permission_callback' => 'gsim_events_require_organizer',
    ]);

    // GET /events/{id}/attendees — Teilnehmer-Liste (eigene Events / Admin)
    register_rest_route($ns, '/events/(?P<id>\d+)/attendees', [
        'methods'  => 'GET',
        'callback' => function ($req) {
            $id = (int) $req['id'];
            $event = get_post($id);
            if (!$event) return new WP_Error('not_found', 'Event nicht gefunden', ['status' => 404]);
            $user_id = get_current_user_id();
            if ($event->post_author != $user_id && !user_can($user_id, 'manage_options')) {
                return new WP_Error('rest_forbidden', 'Nur eigene Events einsehbar', ['status' => 403]);
            }
            $atts = get_posts([
                'post_type'   => GSIM_EVENTS_CPT_ATTENDEE,
                'meta_key'    => '_event_id',
                'meta_value'  => $id,
                'numberposts' => 500,
                'post_status' => 'publish',
            ]);
            return array_map(function ($a) {
                return [
                    'id'         => $a->ID,
                    'name'       => get_post_meta($a->ID, '_attendee_name', true),
                    'email'      => get_post_meta($a->ID, '_attendee_email', true),
                    'order_id'   => (int) get_post_meta($a->ID, '_order_id', true),
                    'ticket_id'  => (int) get_post_meta($a->ID, '_product_id', true),
                    'created'    => $a->post_date,
                ];
            }, $atts);
        },
        'permission_callback' => 'gsim_events_require_organizer',
    ]);

    // POST /events/{id}/tickets — Ticket-Produkt erzeugen
    register_rest_route($ns, '/events/(?P<id>\d+)/tickets', [
        'methods'  => 'POST',
        'callback' => function ($req) {
            $event_id = (int) $req['id'];
            $event = get_post($event_id);
            if (!$event || $event->post_type !== 'tribe_events') {
                return new WP_Error('not_found', 'Event nicht gefunden', ['status' => 404]);
            }
            $user_id = get_current_user_id();
            if ($event->post_author != $user_id && !user_can($user_id, 'manage_options')) {
                return new WP_Error('rest_forbidden', 'Nur Event-Autor darf Tickets erzeugen', ['status' => 403]);
            }
            $product = new WC_Product_Simple();
            $product->set_name(sanitize_text_field($req['name'] ?? ($event->post_title . ' — Ticket')));
            $product->set_status('publish');
            $product->set_virtual(true);
            $product->set_catalog_visibility('hidden');   // nur über Event-Seite verkaufen
            $product->set_regular_price((string) (float) ($req['price'] ?? 0));
            $product->set_short_description(sanitize_text_field($req['description'] ?? ''));
            if (isset($req['capacity']) && $req['capacity'] > 0) {
                $product->set_manage_stock(true);
                $product->set_stock_quantity((int) $req['capacity']);
            }
            $pid = $product->save();
            update_post_meta($pid, GSIM_EVENTS_META_TICKET_EVENT, $event_id);
            return [
                'id'       => $pid,
                'name'     => $product->get_name(),
                'price'    => (float) $product->get_price(),
                'capacity' => $product->get_stock_quantity(),
                'event_id' => $event_id,
            ];
        },
        'permission_callback' => 'gsim_events_require_organizer',
        'args' => [
            'name'        => ['type' => 'string'],
            'price'       => ['type' => 'number', 'required' => true],
            'capacity'    => ['type' => 'integer'],
            'description' => ['type' => 'string'],
        ],
    ]);
});

// -----------------------------------------------------------------------------
// Admin-Notice wenn WooCommerce oder TEC fehlt
// -----------------------------------------------------------------------------

add_action('admin_notices', function () {
    $missing = [];
    if (!class_exists('WooCommerce'))       $missing[] = 'WooCommerce';
    if (!class_exists('Tribe__Events__Main')) $missing[] = 'The Events Calendar';
    if ($missing) {
        printf(
            '<div class="notice notice-error"><p><strong>G-Sim Events:</strong> Bitte aktiviere/installiere: %s</p></div>',
            esc_html(implode(', ', $missing))
        );
    }
});
