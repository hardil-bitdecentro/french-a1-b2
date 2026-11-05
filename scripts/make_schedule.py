"""Generate the day-by-day French A1->B2 schedule (Markdown + CSV)."""
import csv
import sys
from datetime import date, timedelta

OUT_MD = sys.argv[1]
OUT_CSV = sys.argv[2]

START = date(2026, 11, 6)
END = date(2027, 5, 6)
# Progress last changed before this moment (ms) is cleared on every device: see applyReset in site/store.js.
RESET_AT_MS = 1793910600000  # 5 Nov 2026 21:30 CET, when day 1 moved to 6 Nov

# Book volumes: (code, name, chapters, first day, last day)
BOOKS = [
    ("Déb.", "Débutant 3e", 60, date(2026, 11, 6), date(2026, 12, 5)),
    ("Int.", "Intermédiaire 4e", 52, date(2026, 12, 6), date(2027, 2, 4)),
    ("Av.", "Avancé 3e", 72, date(2027, 2, 5), date(2027, 4, 4)),
]
EXAM_MODE_START = date(2027, 4, 5)
FULL_MOCK_FROM = date(2027, 4, 18)

FR_MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def fmt(d):
    return f"{DAYS[d.weekday()]} {d.day} {FR_MONTHS[d.month]}"


def is_sunday(d):
    return d.weekday() == 6


# ---------- content pools ----------
W1 = [
    "Présente-toi : nom, âge, pays, travail, ville. (Introduce yourself)",
    "Décris ta famille. (Your family)",
    "Ta journée typique : je me lève, je travaille… (Your typical day)",
    "Décris ton logement : il y a…, à côté de, sur, sous. (Your home)",
    "Ce que tu aimes / n'aimes pas manger. (Food likes and dislikes)",
    "Décris ton meilleur ami : physique et caractère. (Your best friend)",
    "Ta ville en France : qu'est-ce qu'il y a ? (Your town)",
    "Message : invite un ami au cinéma. (Invite a friend)",
    "Tes loisirs : je fais du…, je joue au… (Your hobbies)",
    "Ton week-end prochain : je vais + infinitif. (Next weekend)",
    "Au restaurant : écris le dialogue de ta commande. (Ordering food)",
    "Tes vêtements aujourd'hui et la météo. (Clothes and weather)",
    "8 questions à un nouveau collègue. (Asking questions)",
    "Ton dernier week-end : passé composé avec avoir. (Last weekend)",
    "Ton arrivée en France : passé composé avec être. (Arriving in France)",
    "E-mail à ton propriétaire : un problème dans l'appartement. (Email to landlord)",
    "Compare deux villes : plus… que, moins… que. (Compare two cities)",
    "Ta matinée d'hier : je me suis levé(e)… (Yesterday morning)",
    "Tes 5 objectifs du mois : je veux, je dois, il faut. (Your goals)",
    "Décris une photo de famille : mon, ma, mes, son, sa, ses. (Family photo)",
    "Ton travail : horaires, tâches, collègues. (Your job)",
    "Carte postale à un ami dans ton pays. (Postcard)",
    "Quand j'étais enfant… : imparfait. (Your childhood)",
    "Une soirée où il pleuvait : imparfait + passé composé. (A rainy evening)",
    "Au marché : ta liste et le dialogue (un kilo de, un peu de). (At the market)",
    "Réponds à une annonce : tu veux louer une chambre. (Reply to an ad)",
]
S1 = [
    "Présente-toi 2 min (nom, âge, pays, travail, ville)",
    "Parle de ta famille",
    "Décris ta journée typique",
    "Décris ton logement",
    "Parle de ce que tu aimes manger",
    "Décris ton meilleur ami",
    "Décris ta ville",
    "Parle de tes loisirs",
    "Dis ce que tu vas faire ce week-end",
    "Jeu de rôle : commande au restaurant",
    "Jeu de rôle : achète un vêtement",
    "Pose 8 questions à Claude sur sa « vie »",
    "Raconte ton dernier week-end",
    "Raconte ton arrivée en France",
    "Jeu de rôle : demande ton chemin dans la rue",
    "Parle de ton travail",
    "Compare deux villes",
    "Raconte ta matinée d'hier",
    "Parle de tes projets pour l'année prochaine",
    "Jeu de rôle : achète un billet de train",
    "Jeu de rôle : prends rendez-vous chez le médecin",
    "Parle de ton enfance",
    "La météo et ce que tu fais selon le temps",
    "Jeu de rôle : au marché",
    "Jeu de rôle : appelle pour visiter un appartement",
    "BILAN : présente-toi 3 min sans notes, enregistre-toi, compare avec le jour 1",
]
W2_T1 = [
    "Invite un ami à ton anniversaire (date, lieu, quoi apporter).",
    "Excuse-toi auprès de ton voisin pour le bruit d'hier soir.",
    "Demande à un collègue de changer la date d'une réunion.",
    "Demande des informations sur un cours à une école de langue.",
    "Conseille un restaurant à un ami.",
    "Réponds à un ami qui te demande comment va ta vie en France.",
    "Écris à ton propriétaire : le chauffage ne marche pas.",
    "Annule un rendez-vous avec un ami et propose une autre date.",
    "Propose ton aide comme bénévole à une association.",
    "Annonce : tu vends ton vélo.",
    "Réserve une chambre d'hôtel (dates, demandes particulières).",
    "Remercie un ami qui t'a aidé à déménager.",
    "Organise un week-end avec un ami.",
    "Service client : ton colis n'est pas arrivé.",
    "Invite tes collègues à un pot.",
    "Demande à ton voisin de garder ton chat pendant tes vacances.",
    "Raconte ton dernier voyage à un ami.",
    "Demande à la mairie les horaires de la médiathèque.",
    "Félicite un ami pour son nouveau travail.",
    "Explique ton absence à ton professeur.",
    "Demande un conseil à un ami (travail ou logement).",
    "Demande les tarifs et horaires d'une salle de sport.",
    "Souhaite bonne année à tes collègues et raconte tes vacances.",
    "Conseils pratiques à un ami qui veut venir en France.",
    "Propose à un ami de faire un échange de langues.",
    "Demande à ta banque un rendez-vous et explique pourquoi.",
]
W2_T2 = [
    "Blog : ta première semaine en France.",
    "Un repas de fête qui t'a marqué.",
    "Une personne qui t'a inspiré, et pourquoi.",
    "Un voyage qui s'est mal passé.",
    "Article : une fête traditionnelle de ton pays.",
    "Ton premier jour dans ton travail actuel.",
    "Ta ville idéale.",
    "Un film ou un livre que tu as aimé.",
    "Témoignage : apprendre une langue à l'âge adulte.",
    "Une journée sans téléphone.",
    "Un lieu en France que tu as visité : décris-le et conseille-le.",
    "Un souvenir d'enfance (imparfait + passé composé).",
    "Une rencontre importante dans ta vie.",
    "Tes habitudes alimentaires et comment elles ont changé en France.",
    "Une erreur qui t'a appris quelque chose.",
    "Blog : conseils pour s'installer dans une nouvelle ville.",
    "Explique le métier de développeur à quelqu'un qui ne le connaît pas.",
    "Tes fêtes de fin d'année cette année.",
    "Le sport dans ta vie.",
    "Ce que tu ferais si tu gagnais au loto (conditionnel).",
    "Ton week-end idéal dans ta ville.",
    "Une fois où tu as parlé français et tu étais fier/fière.",
    "Comment tu as appris à cuisiner un plat.",
    "Avantages et inconvénients de vivre en ville.",
    "Ta meilleure journée de 2026.",
    "Un objet important pour toi et son histoire.",
    "Une fois où tu t'es perdu(e).",
]
S2_T1 = [
    "Présente-toi en détail (parcours, travail, projets), 2 min chrono",
    "Parle de ton parcours professionnel",
    "Pourquoi apprends-tu le français ?",
    "Décris une journée de travail récente",
    "Parle d'un voyage que tu as fait",
    "Parle de tes amis et de ce que vous faites ensemble",
    "Comment fêtes-tu les fêtes de fin d'année ?",
    "Raconte le dernier film ou livre que tu as aimé",
    "Ta vie en France : qu'est-ce qui te plaît ?",
    "Tes projets pour les cinq prochaines années",
    "Parle de ta ville d'origine",
    "Ton logement actuel et ce que tu aimerais changer",
    "Tes habitudes alimentaires",
    "Une personne importante pour toi",
    "Comment utilises-tu la technologie au quotidien ?",
    "Tes loisirs et ton sport préféré",
    "Tes meilleures vacances",
    "Que fais-tu pour rester en bonne santé ?",
    "Ton week-end dernier",
    "Une fête de ton pays",
    "Comment apprends-tu le français ?",
    "Parle de ton quartier",
    "Ton premier jour en France",
    "Quel métier voulais-tu faire enfant ?",
    "La musique que tu écoutes",
    "Ce que tu as appris de nouveau ce mois-ci",
]
S2_T2 = [
    "Tu veux t'inscrire dans une salle de sport : pose des questions (prix, horaires, cours)",
    "Tu cherches une colocation : interroge le propriétaire",
    "Ton ami organise un voyage : pose-lui des questions",
    "Tu veux suivre un cours de cuisine",
    "Tu veux acheter un vélo d'occasion",
    "Tu veux louer une voiture",
    "Tu veux t'inscrire à la médiathèque",
    "Tu veux adopter un chat dans un refuge",
    "Tu veux faire du bénévolat dans une association",
    "Tu veux réserver une salle pour une fête",
    "Un ami t'invite à un concert : pose des questions",
    "Tu veux changer d'opérateur téléphonique",
    "Tu veux ouvrir un compte en banque",
    "Tu veux prendre des cours de danse",
    "Tu cherches un emploi : interroge le recruteur",
    "Week-end en Normandie : interroge l'office de tourisme",
    "Tu veux acheter un ordinateur dans un magasin",
    "Tu organises un anniversaire surprise avec un ami",
    "Tu veux t'inscrire à un club de randonnée",
    "Tu veux suivre une formation en ligne",
    "Tu veux louer un appartement pour les vacances",
    "Ton voisin vend sa voiture : pose des questions",
    "Tu veux participer à un échange linguistique",
    "Tu veux réserver un restaurant pour 12 personnes",
    "Tu veux t'inscrire à un cours de yoga",
    "Tu veux visiter un musée avec un groupe",
]
W3_T1 = [
    "Demande à ton manager une journée de télétravail par semaine, avec arguments.",
    "Plains-toi auprès d'une agence immobilière d'un retard de travaux.",
    "Convaincs un ami de participer à une course caritative.",
    "Propose à la mairie une amélioration pour ton quartier.",
    "Demande un remboursement à un organisme de formation.",
    "Explique à un ami pourquoi tu ne peux pas venir à son mariage.",
    "Propose une fête des voisins à ton immeuble.",
    "Réponds à une offre d'emploi de développeur.",
    "Réagis à un article du journal local sur les pistes cyclables.",
    "Demande une recommandation à un ancien collègue.",
    "Résilie ton abonnement au club de sport et explique pourquoi.",
    "Conseille un ami qui hésite à partir au Canada.",
    "Compagnie aérienne : ton bagage est perdu.",
    "Propose à une bibliothèque de créer un club de conversation.",
    "Recommande une série à un ami, en argumentant.",
    "Négocie le loyer avec ton propriétaire.",
    "Organise une collecte de vêtements avec tes voisins.",
]
W3_T2 = [
    "Une décision difficile que tu as prise et ses conséquences.",
    "Blog d'expatriés : ce qui t'a surpris en France.",
    "Un projet professionnel dont tu es fier/fière.",
    "Une expérience de bénévolat (réelle ou imaginaire).",
    "L'évolution de ton métier depuis dix ans.",
    "Un malentendu culturel que tu as vécu.",
    "Comment tu organises ton temps pour apprendre le français.",
    "Un échec qui t'a finalement aidé.",
    "Une tradition de ton pays, pour des lecteurs français.",
    "Un voyage qui a changé ta façon de voir le monde.",
    "Le jour où tu as reçu une très bonne nouvelle.",
    "Une application qui a changé ton quotidien.",
    "Ta première conversation entièrement en français.",
    "Ton quartier et son ambiance.",
    "Une fois où tu as aidé un inconnu.",
    "Ta vie au Canada dans cinq ans.",
    "Les avantages et difficultés du travail à distance.",
]
T3_TOPICS = [
    "Le télétravail : liberté ou isolement ?",
    "Les réseaux sociaux rapprochent-ils ou isolent-ils les gens ?",
    "Faut-il interdire les voitures dans le centre des villes ?",
    "Un service civique obligatoire pour les jeunes ?",
    "Apprendre une langue étrangère dès la maternelle ?",
    "La semaine de quatre jours : bonne ou mauvaise idée ?",
    "Les devoirs à la maison sont-ils utiles ?",
    "Les musées devraient-ils être gratuits ?",
    "Vivre en ville ou à la campagne ?",
    "L'intelligence artificielle : menace ou chance pour l'emploi ?",
    "Faut-il interdire les téléphones à l'école ?",
    "Le tourisme de masse : richesse ou problème ?",
    "Acheter d'occasion : mode passagère ou vrai changement ?",
    "Faut-il manger moins de viande pour la planète ?",
    "Étudier à l'étranger : indispensable pour une carrière ?",
    "Faut-il limiter le temps d'écran des enfants ?",
    "Le vélo en ville : avenir ou danger ?",
    "Les livres papier vont-ils disparaître ?",
    "Grande entreprise ou start-up ?",
    "Des transports en commun gratuits ?",
    "Les applications de rencontre ont-elles changé l'amour ?",
    "Un uniforme à l'école ?",
    "L'immigration qualifiée : une chance pour le pays d'accueil ?",
    "Faut-il interdire les vols intérieurs courts ?",
    "Le bilinguisme : atout indispensable au travail ?",
    "Faut-il taxer la malbouffe ?",
    "Les jeux vidéo : éducatifs ou perte de temps ?",
    "Vivre seul ou en colocation ?",
    "Faut-il travailler pendant ses études ?",
    "Interdire la publicité destinée aux enfants ?",
    "Un monde sans argent liquide : progrès ou danger ?",
    "Un animal de compagnie en appartement : bonne idée ?",
    "Le droit de vote à 16 ans ?",
    "Cuisine maison ou plats livrés ?",
    "Influenceur : un vrai métier ?",
    "Faut-il protéger les petits commerces face aux grandes surfaces ?",
    "Le bénévolat devrait-il compter sur un CV ?",
    "Apprendre en ligne ou en classe ?",
    "Faut-il encourager la voiture électrique ?",
    "Les grandes villes sont-elles encore agréables à vivre ?",
    "Open space : efficacité ou stress ?",
    "Vacances : partir loin ou rester près de chez soi ?",
    "Faut-il encadrer les loyers dans les grandes villes ?",
    "La lecture chez les jeunes est-elle en danger ?",
    "Les entreprises doivent-elles imposer le retour au bureau ?",
    "Le recyclage suffit-il à protéger l'environnement ?",
    "Les examens sont-ils un bon moyen d'évaluer ?",
    "Changer de pays pour sa carrière : risque ou opportunité ?",
]
S3_T3 = [
    "Le télétravail est-il l'avenir du travail ?",
    "Les réseaux sociaux sont-ils dangereux pour les jeunes ?",
    "Faut-il apprendre plusieurs langues aujourd'hui ?",
    "Les villes devraient-elles interdire les voitures ?",
    "L'argent fait-il le bonheur ?",
    "Vaut-il mieux vivre en ville ou à la campagne ?",
    "L'IA va-t-elle remplacer les humains au travail ?",
    "Les voyages forment-ils la jeunesse ?",
    "Faut-il manger moins de viande ?",
    "Le sport devrait-il être encouragé au travail ?",
    "Un téléphone avant 15 ans ?",
    "Faut-il garder sa culture d'origine quand on vit à l'étranger ?",
    "Des transports publics gratuits ?",
    "Diplôme ou expérience : qu'est-ce qui compte le plus ?",
    "La télévision a-t-elle encore un avenir ?",
    "Faut-il travailler moins pour vivre mieux ?",
    "La mode éthique : effet de mode ou vraie prise de conscience ?",
    "Les célébrités ont-elles une responsabilité envers leurs fans ?",
    "Faut-il interdire la publicité dans l'espace public ?",
    "Le bénévolat obligatoire pour les étudiants ?",
    "Changer souvent d'emploi : bonne idée ?",
    "L'immigration enrichit-elle un pays ?",
    "Faut-il limiter le tourisme dans certaines villes ?",
    "La lecture est-elle encore importante à l'ère numérique ?",
    "Peut-on être heureux sans internet ?",
]
S3_T2 = [
    "Formation professionnelle : interroge le conseiller",
    "Appartement meublé : interroge l'agent immobilier",
    "Séminaire d'entreprise : interroge le responsable de l'hôtel",
    "Ton ami part travailler au Canada : questions sur son projet",
    "Association écologique : questions avant d'adhérer",
    "Vélo électrique : interroge le vendeur",
    "Stage en start-up : interroge le recruteur",
    "École pour un enfant : interroge la directrice",
    "Voyage organisé : interroge l'agence",
    "Marathon : interroge l'organisateur",
    "Changer de banque : interroge le conseiller",
    "Cours de théâtre : interroge le professeur",
    "Un collègue revient d'un congé sabbatique : pose-lui des questions",
    "Gîte pour un week-end en famille",
    "Voiture d'occasion chez un particulier",
    "Salle d'escalade : inscription",
    "Fête de quartier : interroge la mairie",
    "Abonnement de transport annuel",
    "Ton ami a déménagé : questions sur sa nouvelle vie",
    "Cours de cuisine française",
    "Colocation avec un(e) inconnu(e)",
    "Covoiturage régulier : interroge le conducteur",
    "Réparer ton téléphone : interroge le technicien",
    "Club de lecture : inscription",
    "Randonnée guidée en montagne",
]


# ---------- calendar ----------
def all_days():
    d = START
    while d <= END:
        yield d
        d += timedelta(days=1)


def study_days(a, b):
    out, d = [], a
    while d <= b:
        if not is_sunday(d):
            out.append(d)
        d += timedelta(days=1)
    return out


# chapter assignment: day -> (code, first, last)
chapters = {}
for code, _name, n, a, b in BOOKS:
    days = study_days(a, b)
    k = len(days)
    for i, d in enumerate(days):
        lo = (i * n) // k + 1
        hi = ((i + 1) * n) // k
        chapters[d] = (code, lo, hi)

# Vocabulary book (Vocabulaire progressif du français, intermédiaire): 25 chapters, each split into
# two halves, on 50 evenly spaced study days between 7 Dec and 2 Apr. Other evenings use the word deck.
VOCAB_CHAPTERS = 25
VOCAB_FROM, VOCAB_TO = date(2026, 12, 6), date(2027, 4, 2)
vocab = {}
_vdays = study_days(VOCAB_FROM, VOCAB_TO)
_units = VOCAB_CHAPTERS * 2
assert len(_vdays) >= _units
for u in range(_units):
    vocab[_vdays[(u * len(_vdays)) // _units]] = (u // 2 + 1, u % 2)


def vocab_label(t):
    ch, half = t
    return f"ch. {ch}, {'first' if half == 0 else 'second'} half"


def ch_label(t):
    if not t:
        return None
    code, lo, hi = t
    return f"{code} {lo}" if lo == hi else f"{code} {lo}–{hi}"


def prev_study_day(d):
    p = d - timedelta(days=1)
    if is_sunday(p):
        p -= timedelta(days=1)
    return p


def phase_of(d):
    if d <= BOOKS[0][4]:
        return 1
    if d <= BOOKS[1][4]:
        return 2
    if d < EXAM_MODE_START:
        return 3
    return 4


SENTENCES_FROM = date(2027, 1, 4)
SENTENCES_PER_DAY = 8
SAY_FROM = date(2027, 1, 11)  # speaking cards start a week after reading, so there is something to unlock
SAY_PER_DAY = 6


def sent_new(d):
    """New reading sentences (French → English flashcards) per study day, 4 Jan → 3 Apr."""
    return SENTENCES_PER_DAY if SENTENCES_FROM <= d <= BOOKS[2][4] and not is_sunday(d) else 0


def say_new(d):
    """New speaking cards (English → say it in French) per study day, 11 Jan → 3 Apr."""
    return SAY_PER_DAY if SAY_FROM <= d <= BOOKS[2][4] and not is_sunday(d) else 0


def anki_new(d):
    if d < date(2027, 3, 1):
        return 25
    if d < date(2027, 4, 1):
        return 20
    return 15


# Vincent, "Learn French in 5 Days - The Legacy Version" (playlist PLdR5FaFp7N5M): video id, length (s),
# and lesson start times (s) read from each video's transcript ("Hi everyone and welcome to Learn French
# with Vincent" opens every lesson). 1 hour a day across the Débutant phase, cut on lesson boundaries.
VINCENT = [
    ("keBSvVsEibI", 15015, [0, 202, 470, 742, 969, 1530, 1841, 2205, 2639, 2809, 3072, 3351, 3669, 4288, 4653,
                            4980, 5154, 5380, 5908, 6367, 6733, 6910, 7183, 7417, 7758, 8032, 8220, 8582, 8887,
                            9206, 9469, 9746, 10386, 10679, 10926, 11371, 11852, 12160, 12526, 12713, 13042,
                            13250, 13602, 13924, 14197, 14398, 14602]),
    ("QzY_nYZ0RSQ", 16978, [0, 439, 775, 1119, 1304, 1575, 1859, 2081, 2275, 2422, 2596, 3226, 3807, 3935, 4076,
                            4378, 5658, 6345, 6815, 7004, 7997, 8601, 8758, 8888, 9082, 9182, 9315, 9427, 9614,
                            9948, 10247, 10507, 11089, 11327, 11665, 12202, 12594, 12741, 12984, 13372, 13933,
                            14056, 14230, 14344, 14462, 14564, 14708, 14829, 15426, 16384]),
    ("12YUmS3rNr8", 28105, [0, 574, 1146, 1600, 1883, 2399, 3424, 3636, 3780, 3955, 4119, 4558, 5274, 5551, 5728,
                            6982, 7402, 7795, 8112, 8317, 8471, 8637, 8733, 9567, 10419, 10961, 11466, 11801,
                            12009, 12126, 13042, 14648, 15131, 15586, 15976, 16316, 16621, 17753, 18359, 19348,
                            20336, 21656, 22342, 23387, 24529, 25230, 26438, 26991, 27733]),
    ("ppYImLa36ug", 17995, [0, 1389, 2500, 2762, 3016, 3301, 3585, 3822, 4349, 4775, 5308, 5449, 5935, 6430, 6643,
                            7312, 8238, 8592, 8905, 9191, 9489, 9766, 9977, 10234, 10417, 10681, 10897, 11053,
                            11286, 11534, 11707, 11977, 12206, 12406, 12600, 12819, 13005, 13189, 13411, 13590,
                            13769, 14004, 14399, 14678, 14982, 15296, 15389, 15478, 15541, 15662, 15749, 15850,
                            16052, 16219, 16352, 16493, 16696, 16943, 17205, 17485, 17640, 17791]),
    ("b1sXCZDuxSY", 14074, [0, 255, 538, 747, 1080, 1269, 1546, 1760, 2070, 2356, 2513, 2686, 2943, 3236, 3391,
                            3571, 3765, 3987, 4149, 4459, 4733, 5017, 5260, 5838, 5959, 6265, 6414, 6851, 7125,
                            7732, 8293, 8926, 9341, 9653, 9968, 10191, 10481, 10864, 11145, 11462, 11742, 12000,
                            12173, 12326, 12718, 13666]),
]


def hms(sec):
    return f"{sec // 3600}:{sec % 3600 // 60:02d}:{sec % 60:02d}"


def vincent_slots(days):
    """Split the whole course over `days` (study days), cutting only at lesson starts."""
    offsets, o = [], 0
    for _vid, length, _st in VINCENT:
        offsets.append(o)
        o += length
    total = o
    lesson_starts = [offsets[v] + st for v, (_i, _l, sts) in enumerate(VINCENT) for st in sts]
    cuts = sorted(set(lesson_starts[1:] + offsets[1:]))  # every lesson start is a legal cut
    ends, prev = [], 0
    for i in range(len(days) - 1):
        target = (i + 1) * total / len(days)
        cand = [c for c in cuts if c > prev]
        best = min(cand, key=lambda c: abs(c - target))
        ends.append(best)
        prev = best
    ends.append(total)
    slots, start = {}, 0
    for d, end in zip(days, ends):
        segs = []
        for v, (vid, length, _st) in enumerate(VINCENT):
            a, b = max(start, offsets[v]), min(end, offsets[v] + length)
            if b > a:
                segs.append({"video": v + 1, "id": vid, "from": a - offsets[v], "to": b - offsets[v],
                             "length": length})
        first = next(i for i, ls in enumerate(lesson_starts) if ls >= start) + 1
        last = sum(1 for ls in lesson_starts if ls < end)
        parts = [f"Day {g['video']} video {hms(g['from'])} → {'end' if g['to'] == g['length'] else hms(g['to'])}"
                 for g in segs]
        slots[d] = {
            "text": f"Vincent · Learn French in 5 Days (Legacy) · {', then '.join(parts)} · "
                    f"lessons {first}–{last} of {len(lesson_starts)}",
            "links": [{k: g[k] for k in ("video", "id", "from", "to")} for g in segs],
            "minutes": round((end - start) / 60),
        }
        start = end
    return slots


def tv5(d):
    if d < date(2026, 12, 4):
        return "TV5MONDE EDU · A1 · 2 exercises"
    if d < date(2027, 1, 19):
        return "TV5MONDE EDU · A2 · 3 exercises"
    if d < date(2027, 3, 19):
        return "TV5MONDE EDU · B1 · 3 exercises"
    if d < EXAM_MODE_START:
        return "TV5MONDE EDU · B2 · 3 exercises"
    return "Timed TCF-style listening + reading (official samples, TV5MONDE B2): 50 min"


def youtube(d):
    if d <= BOOKS[0][4]:
        return "Vincent · Learn French in 5 Days (Legacy) · 1 hour, the exact part for each day is listed"
    if d < date(2027, 2, 1):
        return "Easy French · 'Super Easy French' playlist, next video"
    if d < EXAM_MODE_START:
        return "Easy French · next episode (French subtitles → none)"
    return "(replaced by timed listening)"


# counters per pool
idx = {k: 0 for k in ["w1", "s1", "w2a", "w2b", "s2a", "s2b", "w3a", "w3b", "t3", "s3a", "s3b", "s4"]}


def take(pool, key):
    item = pool[idx[key] % len(pool)]
    idx[key] += 1
    return item


vincent = vincent_slots(study_days(BOOKS[0][3], BOOKS[0][4]))
rows = []
study_n = 0
for d in all_days():
    ph = phase_of(d)
    row = {
        "date": d.isoformat(),
        "day": fmt(d),
        "phase": ph,
        "anki": anki_new(d),
        "sent": sent_new(d),
        "say": say_new(d),
        "tv5": tv5(d),
        "yt": vincent[d]["text"] if d in vincent else youtube(d),
        "yt_kind": youtube(d),
        "yt_links": vincent[d]["links"] if d in vincent else None,
        "vocab": vocab_label(vocab[d]) if d in vocab else None,
    }
    if is_sunday(d):
        row["sunday"] = True
        rows.append(row)
        continue
    study_n += 1
    row["sunday"] = False
    # book
    if ph < 4:
        row["book"] = ch_label(chapters[d])
    else:
        row["book"] = "Error-log chapters: redo the 2 weakest (any volume)"
    # writing + speaking
    if ph == 1:
        row["write"] = take(W1, "w1")
        row["speak"] = take(S1, "s1")
    elif ph == 2:
        if study_n % 2:
            row["write"] = "Tâche 1 (60–120 mots) : " + take(W2_T1, "w2a")
            row["speak"] = "Tâche 2 : " + take(S2_T2, "s2b")
        else:
            row["write"] = "Tâche 2 (120–150 mots) : " + take(W2_T2, "w2b")
            row["speak"] = "Tâche 1 : " + take(S2_T1, "s2a")
    elif ph == 3:
        r = study_n % 3
        if r == 0:
            row["write"] = "Tâche 1 (60–120 mots) : " + take(W3_T1, "w3a")
        elif r == 1:
            row["write"] = "Tâche 2 (120–150 mots) : " + take(W3_T2, "w3b")
        else:
            row["write"] = ("Tâche 3 (120–180 mots, 2 points de vue + ton avis) : "
                            + take(T3_TOPICS, "t3"))
        if study_n % 2:
            row["speak"] = "Tâche 3 (4 min 30) : " + take(S3_T3, "s3a")
        else:
            row["speak"] = "Tâche 2 (5 min 30) : " + take(S3_T2, "s3b")
    else:
        if d.weekday() == 5:
            row["write"] = "FULL writing paper, 60 min timed: tâche 1 + 2 + 3 (pick unused prompts)"
        else:
            row["write"] = "Tâche 3 timed (40 min) : " + take(T3_TOPICS, "t3")
        i = idx["s4"]
        idx["s4"] += 1
        row["speak"] = (f"2nd attempt, compare with your first recording: "
                        f"T2 « {S3_T2[i % len(S3_T2)]} » + T3 « {S3_T3[i % len(S3_T3)]} »")
    # evening re-test
    if ph < 4:
        parts = []
        y = prev_study_day(d)
        if y in chapters and y >= START:
            parts.append(f"yesterday: {ch_label(chapters[y])}")
        w = d - timedelta(days=7)
        if w in chapters:
            parts.append(f"day −7: {ch_label(chapters[w])}")
        row["retest"] = " · ".join(parts) if parts else "nothing yet (first day)"
    else:
        row["retest"] = "1 exercise from each error-log chapter done this week"
    rows.append(row)


# ---------- Sunday content ----------
def week_chapters(sunday):
    labs = []
    for i in range(6, 0, -1):
        d = sunday - timedelta(days=i)
        if d in chapters:
            labs.append(chapters[d])
    return labs


def span(labs):
    if not labs:
        return None
    groups = []
    for code, lo, hi in labs:
        if groups and groups[-1][0] == code:
            groups[-1][2] = hi
        else:
            groups.append([code, lo, hi])
    return ", ".join(f"{c} {a}–{b}" if a != b else f"{c} {a}" for c, a, b in groups)


def last_sunday_of_month(d):
    return is_sunday(d) and (d + timedelta(days=7)).month != d.month


MOCK_ROT = ["listening (35 min)", "reading (60 min)", "writing (60 min)", "speaking (12 min, recorded)"]
month_start_marker = START
mock_i = 0
for row in rows:
    if not row["sunday"]:
        continue
    d = date.fromisoformat(row["date"])
    items = ["Flashcard reviews (15 min)"]
    labs = week_chapters(d)
    vch = sorted({vocab[d - timedelta(days=i)][0] for i in range(6, 0, -1) if (d - timedelta(days=i)) in vocab})
    vtxt = ""
    if vch:
        vtxt = f" and Vocab. ch. {vch[0]}" + (f"–{vch[-1]}" if vch[-1] != vch[0] else "")
    if labs:
        items.append(f"Week re-test (60 min): 1 exercise from each of {span(labs)}{vtxt}, covered, from memory")
    elif d >= EXAM_MODE_START:
        items.append("Re-test (60 min): every error-log chapter you redid this week")
    items.append("Error log (30 min): group by type; anything 3×+ → redo that chapter")
    if d >= FULL_MOCK_FROM:
        items.append("FULL MOCK, all 4 parts, real timing (≈3 h), then score it against the NCLC 7 table")
    else:
        items.append("Long speaking (90 min): café-langue / Meetup / exchange partner, or 3 timed Claude role-plays")
        if d >= date(2027, 2, 1):
            items.append(f"Mock section (45–60 min): {MOCK_ROT[mock_i % 4]}")
            mock_i += 1
    if last_sunday_of_month(d):
        mlabs = []
        x = month_start_marker
        while x < d:
            if x in chapters:
                mlabs.append(chapters[x])
            x += timedelta(days=1)
        if mlabs:
            items.append(f"MONTHLY REVIEW (+30 days): skim + redo the 'bilan' of {span(mlabs)}")
        month_start_marker = d
    row["sunday_items"] = items


# ---------- write Markdown ----------
PHASE_NAME = {1: "Débutant (A1)", 2: "Intermédiaire (A2→B1)", 3: "Avancé (B1→B2)", 4: "Exam mode (B2)"}
L = []
L.append("# French A1 → B2: day-by-day schedule")
L.append("")
L.append("Fri 6 Nov 2026 → Thu 6 May 2027 · 4 h/day · the full plan and the reasoning are in "
         "`French A1 to B2 in 6 months (TCF Canada).md` next to this file.")
L.append("")
L.append("## The same every day (only the items in the tables change)")
L.append("")
L.append("| Session | Min | What |")
L.append("| ------- | --- | ---- |")
L.append("| **Morning** (e.g. 08:00–09:40) | 15 | Flashcards: all due reviews (in the app's Cards tab) |")
L.append("| | 50 | **Book**: the day's chapters. Read the rule → close the book, say it aloud → exercises without looking → check the Corrigés |")
L.append("| | 10 | Make 2–3 flashcards per chapter + one per mistake |")
L.append("| | 15 | **Write** the day's prompt → paste into Claude for correction → mistakes into the error log |")
L.append("| **Afternoon** (e.g. 14:00–15:40) | 40 | **TV5MONDE EDU** at the level in the week header |")
L.append("| | 30 | **YouTube** from the week header: watch with subtitles, again without, shadow 1 min aloud |")
L.append("| | 20 | **Speak** the day's task (Claude voice mode, a partner, or real life) and record it |")
L.append("| **Evening** (e.g. 20:30–21:30) | 25 | Flashcards: the week header's number of new words |")
L.append("| | 15 | **Re-test** the chapters listed: 1 exercise each, answers covered, from memory |")
L.append("| | 20 | Error log aloud (each correct version 3×) + light listening |")
L.append("")
L.append("Minutes shift by phase (more writing/speaking later); see section 6 of the plan. "
         "Any day can be swapped with the next Sunday; just keep the order.")
L.append("")
L.append("**Vocabulary book:** Vocabulaire progressif du français, niveau intermédiaire 3e éd. (25 ch.), "
         "half a chapter on the evenings listed (7 Dec – 2 Apr); the other evenings use the flashcard word deck.")
L.append("")
L.append("**Book volumes:** Déb. = Niveau débutant 3e éd. (60 ch.) · Int. = Niveau intermédiaire 4e éd. "
         "(planned as 52 ch.; if your copy differs, keep ~1 a day and let the dates slide) · "
         "Av. = Niveau avancé 3e éd. (72 ch.).")
L.append("")
L.append("**TCF tasks:** writing tâche 1 = message 60–120 words · tâche 2 = article/story 120–150 · "
         "tâche 3 = two opposing views + your opinion 120–180. Speaking tâche 1 = interview about you (2 min) · "
         "tâche 2 = role-play where you ask the questions (2 min prep, 5 min 30) · tâche 3 = defend an opinion (4 min 30).")
L.append("")

# group by Monday-start weeks
weeks = []
cur = []
for row in rows:
    d = date.fromisoformat(row["date"])
    if d.weekday() == 0 and cur:
        weeks.append(cur)
        cur = []
    cur.append(row)
if cur:
    weeks.append(cur)

last_phase = None
for wi, wk in enumerate(weeks, 1):
    first, last = wk[0], wk[-1]
    phases = sorted({r["phase"] for r in wk})
    for ph in phases:
        if ph != last_phase and ph not in (last_phase,):
            if last_phase is None or ph > last_phase:
                L.append(f"---\n\n# Phase {ph}: {PHASE_NAME[ph]}\n")
                last_phase = ph
    L.append(f"## Week {wi} · {first['day']} – {last['day']}")
    L.append("")
    mid = wk[min(2, len(wk) - 1)]
    tv5s = sorted({r["tv5"] for r in wk}, key=lambda s: [r["tv5"] for r in wk].index(s))
    yts = sorted({r["yt_kind"] for r in wk}, key=lambda s: [r["yt_kind"] for r in wk].index(s))
    ankis = sorted({r["anki"] for r in wk}, reverse=True)
    sents = sorted({r["sent"] for r in wk if r["sent"]})
    if sents:
        L.append(f"- **New sentences (evening):** {sents[0]}/day (French → English reading flashcards)")
    says = sorted({r["say"] for r in wk if r["say"]})
    if says:
        L.append(f"- **New speaking cards (evening):** {says[0]}/day (English → say it in French; each unlocks 2 days after you read it)")
    L.append(f"- **New words (evening):** flashcards, {' → '.join(str(a) for a in ankis)}/day, "
             f"or the vocabulary book on the days it is listed")
    L.append(f"- **Afternoon input:** {' → '.join(tv5s)}")
    if yts[0] != "(replaced by timed listening)":
        L.append(f"- **YouTube:** {' → '.join(y for y in yts if y != '(replaced by timed listening)')}")
    L.append("")
    L.append("| Day | Book (morning) | Write (morning) | Speak (afternoon) | New words (evening) | Re-test (evening) |")
    L.append("| --- | -------------- | --------------- | ----------------- | ------------------- | ----------------- |")
    sundays = []
    for r in wk:
        if r["sunday"]:
            sundays.append(r)
            continue
        words = f"Vocab. {r['vocab']}" if r["vocab"] else f"Flashcards: {r['anki']} new"
        if r["sent"]:
            words += f" + {r['sent']} sentences"
        if r["say"]:
            words += f" + {r['say']} to say"
        L.append(f"| {r['day']} | {r['book']} | {r['write']} | {r['speak']} | {words} | {r['retest']} |")
    L.append("")
    vrows = [r for r in wk if r.get("yt_links")]
    if vrows:
        L.append("**Vincent this week (afternoon, 1 h):**")
        for r in vrows:
            parts = []
            for l in r["yt_links"]:
                url = f"https://www.youtube.com/watch?v={l['id']}&t={l['from']}s"
                parts.append(f"[Day {l['video']} video from {hms(l['from'])}]({url}) → stop at {hms(l['to'])}")
            lessons = r["yt"].rsplit(" · ", 1)[1]
            L.append(f"- {r['day']}: {', then '.join(parts)} ({lessons})")
        L.append("")
    for s in sundays:
        L.append(f"**{s['day']}: review day, no new chapters (4 h)**")
        for it in s["sunday_items"]:
            L.append(f"- {it}")
        L.append("")

L.append("---")
L.append("")
L.append("## After 6 May")
L.append("")
L.append("If the last two Sunday full mocks (25 Apr and 2 May) were both NCLC 7+ in all four skills "
         "(listening ≥ 458, reading ≥ 453, writing ≥ 10, speaking ≥ 10; aim for ~480 / 12), sit the exam. "
         "If one skill is short, repeat the exam-mode week pattern for 4–6 more weeks with extra time on that skill.")
L.append("")

with open(OUT_MD, "w", encoding="utf-8") as f:
    f.write("\n".join(L))

# ---------- write CSV ----------
with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["Date", "Day", "Phase", "Book chapters", "Writing", "Speaking", "Evening re-test",
                "New words", "New sentences", "Vocabulary book", "TV5MONDE / input", "YouTube", "Sunday tasks", "Done"])
    for r in rows:
        if r["sunday"]:
            w.writerow([r["date"], r["day"], r["phase"], "REVIEW DAY", "", "", "", r["anki"], r["sent"], "", "", "",
                        " | ".join(r["sunday_items"]), ""])
        else:
            w.writerow([r["date"], r["day"], r["phase"], r["book"], r["write"], r["speak"], r["retest"],
                        r["anki"], r["sent"], r["vocab"] or "", r["tv5"], r["yt"], "", ""])

if len(sys.argv) > 3:
    import json
    out = []
    for wi, wk in enumerate(weeks, 1):
        for r in wk:
            o = {k: v for k, v in r.items()}
            o["week"] = wi
            out.append(o)
    with open(sys.argv[3], "w", encoding="utf-8") as f:
        json.dump({"start": START.isoformat(), "end": END.isoformat(), "resetAt": RESET_AT_MS, "days": out},
                  f, ensure_ascii=False, indent=1)

print("days:", len(rows), "study days:", study_n)
for code, name, n, a, b in BOOKS:
    ds = study_days(a, b)
    print(f"{name}: {n} ch over {len(ds)} study days ({a}..{b}) = {n/len(ds):.2f}/day")
print("pool use:", idx)
