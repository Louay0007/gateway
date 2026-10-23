/**
 * D17 payment i18n — FR (default), AR (RTL), EN.
 *
 * Scope is deliberate: these strings cover the D17 surfaces only. The
 * rest of the portal is English, and a site-wide i18n migration is a
 * separate piece of work — this module is the seam that makes it a
 * translation job rather than a re-architecture.
 *
 * Resolution order: `?lang=` query → `lang` cookie → `fr`. Arabic sets
 * `dir="rtl"` (see d17-dir()).
 */

export type D17Lang = 'fr' | 'ar' | 'en';

export const D17_LANGS: readonly D17Lang[] = ['fr', 'ar', 'en'];

/** Is this a right-to-left script? */
export function d17Dir(lang: D17Lang): 'rtl' | 'ltr' {
  return lang === 'ar' ? 'rtl' : 'ltr';
}

export function isD17Lang(value: string | null | undefined): value is D17Lang {
  return value === 'fr' || value === 'ar' || value === 'en';
}

type Dict = Record<string, string>;

const fr: Dict = {
  'd17.method': 'D17 (La Poste Tunisienne)',
  'd17.method_hint': "Virement mobile via l'application D17 (DigiPostBank)",

  'd17.instructions_title': 'Payer avec D17',
  'd17.instructions_subtitle': "Suivez les étapes dans l'application D17, puis envoyez le numéro d'autorisation.",
  'd17.step1': "Ouvrez l'application D17 (DigiPostBank).",
  'd17.step2': "Accueil > « Transfert d'argent ».",
  'd17.step3': 'Saisissez le montant EXACT :',
  'd17.step4': 'Saisissez le numéro du destinataire :',
  'd17.step5': "Confirmez avec votre code PIN, puis notez le numéro d'autorisation affiché par D17.",
  'd17.copy': 'Copier',
  'd17.copied': 'Copié',
  'd17.summary_reference': 'Référence',
  'd17.summary_amount': 'Montant à transférer',
  'd17.summary_deadline': 'À payer avant',
  'd17.summary_status': 'Statut',
  'd17.notice': "Votre abonnement n'est confirmé qu'après vérification du paiement (en général sous {hours} heures).",
  'd17.no_pin_notice': 'Ne communiquez jamais votre code PIN, votre numéro de carte ou votre CIN. Nous ne vous les demanderons jamais.',
  'd17.continue': "J'ai effectué le virement",
  'd17.back_dashboard': 'Retour au tableau de bord',

  'd17.proof_title': 'Confirmer votre paiement',
  'd17.proof_subtitle': "Collez le numéro d'autorisation affiché par D17 après le transfert.",
  'd17.field_auth': "Numéro d'autorisation D17",
  'd17.field_auth_hint': "4 à 32 caractères, tel qu'affiché par l'application.",
  'd17.field_phone': 'Numéro de téléphone utilisé',
  'd17.field_phone_hint': '8 chiffres, sans indicatif.',
  'd17.field_screenshot': "Capture d'écran (facultatif)",
  'd17.field_screenshot_hint': 'JPG, PNG ou WebP. 3 Mo maximum. Elle aide la vérification.',
  'd17.field_confirm': 'Je confirme avoir transféré le montant exact.',
  'd17.submit': 'Envoyer la preuve de paiement',
  'd17.submitting': 'Envoi…',
  'd17.err_auth_format': "Le numéro d'autorisation doit contenir 4 à 32 caractères alphanumériques.",
  'd17.err_auth_duplicate': "Ce numéro d'autorisation a déjà été utilisé. S'il s'agit d'une erreur, contactez-nous.",
  'd17.err_phone': 'Le numéro de téléphone doit contenir 8 chiffres.',
  'd17.err_confirm': 'Merci de confirmer le montant exact transféré.',
  'd17.err_screenshot': "Capture d'écran invalide (JPG/PNG/WebP, 3 Mo maximum).",
  'd17.err_ratelimited': 'Trop de tentatives. Réessayez plus tard.',
  'd17.err_expired': 'Le délai de paiement est dépassé. Recommencez le paiement.',
  'd17.err_generic': "L'envoi a échoué. Réessayez plus tard.",

  'd17.waiting_title': 'Preuve de paiement reçue',
  'd17.waiting_subtitle': "Nous vérifions votre virement D17. Votre abonnement s'activera automatiquement après validation.",
  'd17.waiting_email_note': 'Un e-mail de confirmation vous a été envoyé.',
  'd17.waiting_review': 'Votre paiement est en cours de contrôle renforcé (délai habituellement un peu plus long).',
  'd17.resubmit': 'Envoyer une nouvelle preuve',

  'd17.rejected_banner': 'Votre preuve de paiement a été refusée : {reason}. Vous pouvez en envoyer une nouvelle.',
  'd17.status_pending': 'En attente de paiement',
  'd17.status_submitted': 'Preuve envoyée',
  'd17.status_paid': 'Payé',
  'd17.status_rejected': 'Refusé',
  'd17.status_expired': 'Expiré',

  'd17.email_received_subject': 'Nous avons reçu votre preuve de paiement D17',
  'd17.email_received_body':
    "Bonjour,\n\nNous avons bien reçu votre preuve de paiement D17 pour l'abonnement {plan} " +
    "({amount} DT).\n\nNous vérifions le virement dans l'application D17 — cela prend en général " +
    "moins de {hours} heures. Votre abonnement sera activé automatiquement après validation, " +
    "et vous recevrez un e-mail de confirmation.\n\nNuméro d'autorisation : {auth}\n\n" +
    "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.",
  'd17.email_approved_subject': 'Paiement confirmé — votre abonnement est actif',
  'd17.email_approved_body':
    'Bonjour,\n\nFélicitations ! Votre paiement D17 de {amount} DT a été vérifié et votre abonnement {plan} est maintenant actif.\n\n' +
    'Votre plan Pro inclut :\n' +
    '• 1000 prompts Smart (Sonnet 5) par mois\n' +
    '• 500 prompts Frontier (Opus 5.5) par mois\n' +
    '• 300 requêtes par minute\n' +
    '• 1,5M tokens par minute\n' +
    '• Jusqu\'à 15 clés API\n' +
    '• Support prioritaire\n\n' +
    'Vous pouvez maintenant créer vos clés API et commencer à utiliser l\'API.\n\nMerci pour votre confiance !',
  'd17.email_rejected_subject': 'Votre preuve de paiement D17 a été refusée',
  'd17.email_rejected_body':
    "Bonjour,\n\nNous n'avons pas pu vérifier votre paiement D17 de {amount} DT.\n\n" +
    "Motif : {reason}\n\nVous pouvez envoyer une nouvelle preuve depuis votre espace " +
    "abonnement. Si vous pensez qu'il s'agit d'une erreur, répondez à cet e-mail.",

  'd17.notify_admin_subject': '[D17] Nouvelle preuve de paiement à vérifier',
  'd17.notify_admin_body':
    "Une preuve de paiement D17 attend vérification.\n\n" +
    "Organisation : {org}\nAbonnement : {plan}\nMontant : {amount} DT\n" +
    "Numéro d'autorisation : {auth}\nTéléphone expéditeur : {phone}\n" +
    "Soumise : {submittedAt}\n\n" +
    "Vérifiez dans D17 > historique des transactions : le montant, le numéro " +
    "expéditeur, le numéro d'autorisation et une date récente.",

  // ── Stepper labels ──────────────────────────────────────────────────
  'd17.step_transfer': 'Transfert',
  'd17.step_proof': 'Preuve',
  'd17.step_verify': 'Vérification',
  'd17.step_active': 'Actif',

  // ── State explanations ──────────────────────────────────────────────
  'd17.state_pending_explain': "Effectuez le virement dans l'application D17, puis soumettez votre preuve ci-dessous.",
  'd17.state_submitted_explain': "Notre équipe vérifie votre transfert. Vous recevrez un e-mail dès que votre abonnement sera activé.",
  'd17.state_rejected_explain': "La preuve fournie n'a pas pu être vérifiée. Vérifiez les informations et soumettez une nouvelle preuve.",
  'd17.state_expired_explain': 'Le délai de paiement est dépassé. Veuillez recommencer le processus de paiement.',
  'd17.state_paid_explain': "Votre paiement a été confirmé. Votre abonnement est actif et prêt à l'emploi.",

  // ── Plan features ───────────────────────────────────────────────────
  'd17.plan_starter_name': 'Starter',
  'd17.plan_pro_name': 'Pro',
  'd17.plan_recommended': 'Recommandé',
  'd17.plan_current': 'Plan actuel',
  'd17.plan_choose': 'Choisir ce plan',
  'd17.plan_upgrade': 'Passer à ce plan',
  'd17.feat_fast_model': 'Modèle rapide (Claude Sonnet)',
  'd17.feat_smart_model': 'Modèle intelligent (Claude Opus)',
  'd17.feat_frontier_model': 'Modèle frontier (entreprise)',
  'd17.feat_keys': '{count} clés API',
  'd17.feat_rpm': '{count} appels/min',
  'd17.feat_tpm': '{count} tokens/min',
  'd17.feat_support': 'Support prioritaire',
  'd17.feat_budget': 'Budget mensuel inclus : {amount}',
  'd17.feat_fast_prompts': '{count} prompts rapides',
  'd17.feat_smart_prompts': '{count} prompts intelligents',
  'd17.feat_frontier_prompts': '{count} prompts frontier',
  'd17.prompt_meter_label': '{used} / {limit} prompts {alias}',
  'd17.prompt_limit_exceeded': 'Limite de prompts atteinte pour {model}',
};

const ar: Dict = {
  'd17.method': 'D17 (البريد التونسي)',
  'd17.method_hint': 'تحويل عبر تطبيق D17 (DigiPostBank)',

  'd17.instructions_title': 'الدفع عبر D17',
  'd17.instructions_subtitle': 'اتبع الخطوات في تطبيق D17 ثم أرسل رقم التفويض.',
  'd17.step1': 'افتح تطبيق D17 (DigiPostBank).',
  'd17.step2': 'الرئيسية > «تحويل أموال».',
  'd17.step3': 'أدخل المبلغ بالضبط:',
  'd17.step4': 'أدخل رقم المستلم:',
  'd17.step5': 'أكد برقمك السري، ثم دون رقم التفويض الذي يظهر في التطبيق.',
  'd17.copy': 'نسخ',
  'd17.copied': 'تم النسخ',
  'd17.summary_reference': 'المرجع',
  'd17.summary_amount': 'المبلغ المطلوب تحويله',
  'd17.summary_deadline': 'الدفع قبل',
  'd17.summary_status': 'الحالة',
  'd17.notice': 'لا يتم تأكيد اشتراكك إلا بعد التحقق من الدفع (عادة خلال {hours} ساعة).',
  'd17.no_pin_notice': 'لا تشارك رقمك السري أو رقم بطاقتك أو ب.ت.و. أبداً — لن نطلبها منك.',
  'd17.continue': 'قمت بالتحويل',
  'd17.back_dashboard': 'العودة إلى لوحة التحكم',

  'd17.proof_title': 'تأكيد الدفع',
  'd17.proof_subtitle': 'الصق رقم التفويض الذي ظهر في تطبيق D17 بعد التحويل.',
  'd17.field_auth': 'رقم التفويض D17',
  'd17.field_auth_hint': 'من 4 إلى 32 حرفاً كما يظهر في التطبيق.',
  'd17.field_phone': 'رقم الهاتف المستخدم',
  'd17.field_phone_hint': '8 أرقام بدون الإندicator.',
  'd17.field_screenshot': 'لقطة شاشة (اختياري)',
  'd17.field_screenshot_hint': 'JPG أو PNG أو WebP. 3 ميغابايت كحد أقصى.',
  'd17.field_confirm': 'أؤكد أنني حوّلت المبلغ بالضبط.',
  'd17.submit': 'إرسال إثبات الدفع',
  'd17.submitting': 'جارٍ الإرسال…',
  'd17.err_auth_format': 'يجب أن يحتوي رقم التفويض على 4 إلى 32 حرفاً أو رقماً.',
  'd17.err_auth_duplicate': 'رقم التفويض هذا مستخدم مسبقاً. إذا كان الأمر خطأً، تواصل معنا.',
  'd17.err_phone': 'يجب أن يحتوي رقم الهاتف على 8 أرقام.',
  'd17.err_confirm': 'يرجى تأكيد أنك حوّلت المبلغ بالضبط.',
  'd17.err_screenshot': 'لقطة الشاشة غير صالحة (JPG/PNG/WebP، 3 ميغابايت كحد أقصى).',
  'd17.err_ratelimited': 'محاولات كثيرة. أعد المحاولة لاحقاً.',
  'd17.err_expired': 'انتهت مهلة الدفع. يرجى إعادة المحاولة.',
  'd17.err_generic': 'فشل الإرسال. أعد المحاولة لاحقاً.',

  'd17.waiting_title': 'تم استلام إثبات الدفع',
  'd17.waiting_subtitle': 'نقوم بالتحقق من تحويل D17. سيتم تفعيل اشتراكك تلقائياً بعد الموافقة.',
  'd17.waiting_email_note': 'تم إرسال بريد تأكيد.',
  'd17.waiting_review': 'دفعك قيد المراجعة المعززة (المدة عادة أطول قليلاً).',
  'd17.resubmit': 'إرسال إثبات جديد',

  'd17.rejected_banner': 'تم رفض إثبات الدفع: {reason}. يمكنك إرسال إثبات جديد.',
  'd17.status_pending': 'في انتظار الدفع',
  'd17.status_submitted': 'تم إرسال الإثبات',
  'd17.status_paid': 'مدفوع',
  'd17.status_rejected': 'مرفوض',
  'd17.status_expired': 'منتهي',

  'd17.email_received_subject': 'وصلنا إثبات دفعك عبر D17',
  'd17.email_received_body':
    'مرحباً،\n\nوصلنا إثبات دفعك عبر D17 لاشتراك {plan} ({amount} د.ت).\n\n' +
    'نقوم بالتحقق من التحويل في تطبيق D17 — عادة خلال أقل من {hours} ساعة. ' +
    'سيتم تفعيل اشتراكك تلقائياً بعد التحقق، وستصلك رسالة تأكيد.\n\n' +
    'رقم التفويض: {auth}\n\nإذا لم تطلب ذلك، تجاهل هذه الرسالة.',
  'd17.email_approved_subject': 'تم تأكيد الدفع — اشتراكك نشط',
  'd17.email_approved_body':
    'مرحباً،\n\nتهانينا! تم التحقق من دفعتك عبر D17 بمبلغ {amount} د.ت واشتراك {plan} نشط الآن.\n\n' +
    'يتضمن خطة Pro:\n' +
    '• 1000 طلب Smart (Sonnet 5) شهرياً\n' +
    '• 500 طلب Frontier (Opus 5.5) شهرياً\n' +
    '• 300 طلب في الدقيقة\n' +
    '• 1.5 مليون رمز في الدقيقة\n' +
    '• حتى 15 مفتاح API\n' +
    '• دعم ذو أولوية\n\n' +
    'يمكنك الآن إنشاء مفاتيح API والبدء في استخدام الخدمة.\n\nشكراً لثقتك بنا!',
  'd17.email_rejected_subject': 'تم رفض إثبات دفعك عبر D17',
  'd17.email_rejected_body':
    'مرحباً،\n\nلم نتمكن من التحقق من دفعتك عبر D17 بمبلغ {amount} د.ت.\n\n' +
    'السبب: {reason}\n\nيمكنك إرسال إثبات جديد من صفحة اشتراكك. إذا كنت تعتقد أنه خطأ، ' +
    'يرجى الرد على هذه الرسالة.',

  'd17.notify_admin_subject': '[D17] إثبات دفع جديد بحاجة إلى تحقق',
  'd17.notify_admin_body':
    'إثبات دفع D17 في انتظار التحقق.\n\n' +
    'المنظمة: {org}\nالاشتراك: {plan}\nالمبلغ: {amount} د.ت\n' +
    'رقم التفويض: {auth}\nهاتف المُرسل: {phone}\n' +
    'تاريخ الإرسال: {submittedAt}\n\n' +
    'تحقق في D17 > سجل المعاملات: المبلغ، رقم المُرسل، رقم التفويض، وتاريخ قريب.',

  // ── Stepper labels ──────────────────────────────────────────────────
  'd17.step_transfer': 'التحويل',
  'd17.step_proof': 'الإثبات',
  'd17.step_verify': 'التحقق',
  'd17.step_active': 'نشط',

  // ── State explanations ──────────────────────────────────────────────
  'd17.state_pending_explain': 'قم بالتحويل في تطبيق D17، ثم أرسل إثباتك أدناه.',
  'd17.state_submitted_explain': 'يقوم فريقنا بالتحقق من تحويلك. ستتلقى بريداً إلكترونياً عند تفعيل اشتراكك.',
  'd17.state_rejected_explain': 'تعذر التحقق من الإثبات المقدم. تحقق من التفاصيل وأرسل إثباتاً جديداً.',
  'd17.state_expired_explain': 'انتهت مهلة الدفع. يرجى إعادة بدء عملية الدفع.',
  'd17.state_paid_explain': 'تم تأكيد دفعتك. اشتراكك نشط وجاهز للاستخدام.',

  // ── Plan features ───────────────────────────────────────────────────
  'd17.plan_starter_name': 'Starter',
  'd17.plan_pro_name': 'Pro',
  'd17.plan_recommended': 'موصى به',
  'd17.plan_current': 'الخطة الحالية',
  'd17.plan_choose': 'اختر هذه الخطة',
  'd17.plan_upgrade': 'الترقية إلى هذه الخطة',
  'd17.feat_fast_model': 'نموذج سريع (Claude Sonnet)',
  'd17.feat_smart_model': 'نموذج ذكي (Claude Opus)',
  'd17.feat_frontier_model': 'نموذج frontier (مؤسسات)',
  'd17.feat_keys': '{count} مفاتيح API',
  'd17.feat_rpm': '{count} طلب/دقيقة',
  'd17.feat_tpm': '{count} رمز/دقيقة',
  'd17.feat_support': 'دعم ذو أولوية',
  'd17.feat_budget': 'ميزانية شهرية مضمنة: {amount}',
  'd17.feat_fast_prompts': '{count} طلب سريع',
  'd17.feat_smart_prompts': '{count} طلب ذكي',
  'd17.feat_frontier_prompts': '{count} طلب متقدم',
  'd17.prompt_meter_label': '{used} / {limit} طلبات {alias}',
  'd17.prompt_limit_exceeded': 'تم الوصول إلى حد الطلبات لـ {model}',
};

const en: Dict = {
  'd17.method': 'D17 (La Poste Tunisienne)',
  'd17.method_hint': 'Mobile transfer via the D17 app (DigiPostBank)',

  'd17.instructions_title': 'Pay with D17',
  'd17.instructions_subtitle': 'Follow the steps in the D17 app, then send us the authorization number.',
  'd17.step1': 'Open the D17 app (DigiPostBank).',
  'd17.step2': "Home > \"Transfert d'argent\".",
  'd17.step3': 'Enter the EXACT amount:',
  'd17.step4': 'Enter the recipient number:',
  'd17.step5': 'Confirm with your PIN, then write down the authorization number D17 shows.',
  'd17.copy': 'Copy',
  'd17.copied': 'Copied',
  'd17.summary_reference': 'Reference',
  'd17.summary_amount': 'Amount to transfer',
  'd17.summary_deadline': 'Pay before',
  'd17.summary_status': 'Status',
  'd17.notice': 'Your subscription is confirmed only after we verify the payment (usually within {hours} hours).',
  'd17.no_pin_notice': 'Never share your PIN, card number, or CIN. We will never ask for them.',
  'd17.continue': 'I have made the transfer',
  'd17.back_dashboard': 'Back to dashboard',

  'd17.proof_title': 'Confirm your payment',
  'd17.proof_subtitle': 'Paste the authorization number D17 showed after the transfer.',
  'd17.field_auth': 'D17 authorization number',
  'd17.field_auth_hint': '4 to 32 characters, as shown in the app.',
  'd17.field_phone': 'Phone number you paid from',
  'd17.field_phone_hint': '8 digits, no country code.',
  'd17.field_screenshot': 'Screenshot (optional)',
  'd17.field_screenshot_hint': 'JPG, PNG, or WebP. 3 MB maximum.',
  'd17.field_confirm': 'I confirm I transferred the exact amount.',
  'd17.submit': 'Submit payment proof',
  'd17.submitting': 'Submitting…',
  'd17.err_auth_format': 'The authorization number must be 4 to 32 alphanumeric characters.',
  'd17.err_auth_duplicate': 'This authorization number has already been used. If that is wrong, contact us.',
  'd17.err_phone': 'The phone number must be 8 digits.',
  'd17.err_confirm': 'Please confirm you transferred the exact amount.',
  'd17.err_screenshot': 'Invalid screenshot (JPG/PNG/WebP, 3 MB max).',
  'd17.err_ratelimited': 'Too many attempts. Try again later.',
  'd17.err_expired': 'The payment window has passed. Start again.',
  'd17.err_generic': 'Submission failed. Try again later.',

  'd17.waiting_title': 'Payment proof received',
  'd17.waiting_subtitle': 'We are verifying your D17 transfer. Your subscription activates automatically once approved.',
  'd17.waiting_email_note': 'A confirmation email has been sent.',
  'd17.waiting_review': 'Your payment is under enhanced review (usually a little slower).',
  'd17.resubmit': 'Submit a new proof',

  'd17.rejected_banner': 'Your payment proof was rejected: {reason}. You can submit a new one.',
  'd17.status_pending': 'Awaiting payment',
  'd17.status_submitted': 'Proof submitted',
  'd17.status_paid': 'Paid',
  'd17.status_rejected': 'Rejected',
  'd17.status_expired': 'Expired',

  'd17.email_received_subject': 'We received your D17 payment proof',
  'd17.email_received_body':
    'Hello,\n\nWe received your D17 payment proof for the {plan} subscription ({amount} DT).\n\n' +
    'We verify the transfer in the D17 app — usually within {hours} hours. Your subscription ' +
    'activates automatically once verified, and you will get a confirmation email.\n\n' +
    'Authorization number: {auth}\n\nIf you did not make this request, ignore this email.',
  'd17.email_approved_subject': 'Payment confirmed — your subscription is active',
  'd17.email_approved_body':
    'Hello,\n\nCongratulations! Your D17 payment of {amount} DT has been verified and your {plan} subscription is now active.\n\n' +
    'Your Pro plan includes:\n' +
    '• 1000 Smart prompts (Sonnet 5) per month\n' +
    '• 500 Frontier prompts (Opus 5.5) per month\n' +
    '• 300 requests per minute\n' +
    '• 1.5M tokens per minute\n' +
    '• Up to 15 API keys\n' +
    '• Priority support\n\n' +
    'You can now create your API keys and start using the API.\n\nThank you for your trust!',
  'd17.email_rejected_subject': 'Your D17 payment proof was rejected',
  'd17.email_rejected_body':
    'Hello,\n\nWe could not verify your D17 payment of {amount} DT.\n\n' +
    'Reason: {reason}\n\nYou can submit a new proof from your subscription page. If you believe ' +
    'this is a mistake, reply to this email.',

  'd17.notify_admin_subject': '[D17] New payment proof to verify',
  'd17.notify_admin_body':
    'A D17 payment proof is waiting for verification.\n\n' +
    'Organization: {org}\nSubscription: {plan}\nAmount: {amount} DT\n' +
    'Authorization number: {auth}\nSender phone: {phone}\n' +
    'Submitted: {submittedAt}\n\n' +
    'Verify in D17 > transaction history: the amount, the sender phone, the ' +
    'authorization number, and a recent date.',

  // ── Stepper labels ──────────────────────────────────────────────────
  'd17.step_transfer': 'Transfer',
  'd17.step_proof': 'Proof',
  'd17.step_verify': 'Verification',
  'd17.step_active': 'Active',

  // ── State explanations ──────────────────────────────────────────────
  'd17.state_pending_explain': 'Make the transfer in the D17 app, then submit your proof below.',
  'd17.state_submitted_explain': 'Our team is verifying your transfer. You will receive an email once your subscription is activated.',
  'd17.state_rejected_explain': 'The proof provided could not be verified. Check the details and submit a new proof.',
  'd17.state_expired_explain': 'The payment deadline has passed. Please restart the payment process.',
  'd17.state_paid_explain': 'Your payment has been confirmed. Your subscription is active and ready to use.',

  // ── Plan features ───────────────────────────────────────────────────
  'd17.plan_starter_name': 'Starter',
  'd17.plan_pro_name': 'Pro',
  'd17.plan_recommended': 'Recommended',
  'd17.plan_current': 'Current plan',
  'd17.plan_choose': 'Choose this plan',
  'd17.plan_upgrade': 'Upgrade to this plan',
  'd17.feat_fast_model': 'Fast model (Claude Sonnet)',
  'd17.feat_smart_model': 'Smart model (Claude Opus)',
  'd17.feat_frontier_model': 'Frontier model (enterprise)',
  'd17.feat_keys': '{count} API keys',
  'd17.feat_rpm': '{count} calls/min (rate limit)',
  'd17.feat_tpm': '{count} tokens/min',
  'd17.feat_support': 'Priority support',
  'd17.feat_budget': 'Monthly budget included: {amount}',
  'd17.feat_fast_prompts': '{count} fast prompts',
  'd17.feat_smart_prompts': '{count} smart prompts',
  'd17.feat_frontier_prompts': '{count} frontier prompts',
  'd17.prompt_meter_label': '{used} / {limit} {alias} prompts',
  'd17.prompt_limit_exceeded': 'Prompt limit reached for {model}',
};

const DICTS: Record<D17Lang, Dict> = { fr, ar, en };

/** Translate a key, filling {placeholders}. Falls back to FR, then the key. */
export function t17(lang: D17Lang, key: string, vars?: Record<string, string>): string {
  const raw = DICTS[lang]?.[key] ?? DICTS.fr[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => vars[name] ?? m);
}
