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
# Phase 1 prompts, one per study day, practising that day's chapters (DEB_DAYS) and nothing later.
W1 = [
    "Remplis une fiche : nom, prénom, nationalité, profession, ville. Puis écris 4 phrases : je suis…, il est…, elle est… (Fill in a form, then describe someone)",
    "8 phrases avec être : je suis, tu es, nous sommes, ils sont + adjectif au pluriel. (8 sentences with être)",
    "Tes goûts : j'aime…, je n'aime pas…, est-ce que tu aimes… ? (Likes and dislikes, with questions)",
    "Ta journée typique : je me lève, je me lave, je travaille, je mange… (Your typical day)",
    "Dans ta chambre : 12 objets avec un, une, des. Attention au genre ! (12 things in your room)",
    "Carte postale de ta ville : je visite le…, je suis au…, à la…, je parle du…, de la… Bises ! (A postcard from your town)",
    "Décris une photo de famille : mon, ma, mes, ce, cette ; j'ai un frère… (A family photo)",
    "Décris un ami : il a les yeux…, il a … ans. Puis : j'ai mal à…, j'ai faim, j'ai froid. (A friend, and how you feel)",
    "Ce que tu as et ce que tu n'as pas : j'ai…, je n'ai pas de… (What you have and don't have)",
    "Je suis de…, j'habite à…, en…, au… Puis décris ta chambre : sur, sous, dans, devant. (Cities, countries, where things are)",
    "Qu'est-ce qu'il y a dans ta ville ? Il y a…, il n'y a pas de… (What your town has and doesn't)",
    "Ton avis sur 6 choses à Paris : c'est beau, c'est cher… ; c'est un musée, il est grand. (Your opinions)",
    "2 messages à un ami : rendez-vous samedi 14 novembre à 19 heures, devant la gare. Puis ton emploi du temps de lundi. (Arrange a meeting; your timetable)",
    "Le temps et les repas : en hiver, il fait froid… ; je mange du…, de la…, des… (Weather and food)",
    "Compare deux villes : plus… que, moins… que, autant de… (Compare two cities)",
    "Tes matins : je pars à…, je sors…, je finis…, je choisis… (Your mornings)",
    "Ce que tu sais et qui tu connais : je sais…, je connais…, je crois…, je bois… (What you know, who you know)",
    "SMS : invite un ami ce week-end. Tu veux… ? On peut… ? Je dois… Je fais du… Je vais à… (A text to invite a friend)",
    "Le week-end prochain : je vais + verbe. Le week-end dernier : j'ai mangé, j'ai parlé… (Next and last weekend)",
    "Ton arrivée en France : je suis arrivé(e), j'ai vu, j'ai pris… (Arriving in France)",
    "Quand j'étais petit(e), j'habitais… Dans 10 ans, je serai… (Your childhood and your future)",
    "Ta vie : j'habite ici depuis…, il y a 2 ans, j'ai…, dans 1 an, je vais… (Your life: past, present, future)",
    "8 questions à un nouveau collègue : où, quand, comment, pourquoi, qui, quelle… (Questions for a colleague)",
    "Une mauvaise journée : je n'ai rien mangé, je ne suis pas sorti(e), je ne vois personne… (A bad day)",
    "Réponds sans répéter : 8 questions avec en, y, le, la, les. Tu manges du pain ? Oui, j'en mange. (Answer with pronouns)",
    "E-mail à ton propriétaire : je lui écris…, l'appartement que…, le voisin qui… (Email to your landlord)",
]
S1 = [
    "Présente-toi 2 min : nom, nationalité, profession, ville",
    "Décris tes amis : ils sont…, elles sont…, nous sommes…",
    "Pose 6 questions avec est-ce que et réponds : oui… / non, je ne… pas",
    "Décris ta journée typique",
    "Nomme à voix haute tout ce que tu vois : un…, une…, des…",
    "Décris ta ville : le musée, la gare, au marché, à la boulangerie",
    "Parle de ta famille : mon père, ma mère, j'ai un frère…",
    "Jeu de rôle : chez le médecin, dis où tu as mal",
    "Réponds à 10 questions : tu as une voiture ? Non, je n'ai pas de voiture",
    "Où habites-tu ? Quels pays connais-tu ? À Paris, en France, au Japon…",
    "Montre 8 objets : qu'est-ce que c'est ? C'est un…, ce n'est pas un…",
    "Décris 4 personnes ou lieux : c'est…, il est…",
    "Dis à voix haute : ta date de naissance, ton téléphone, 6 prix, l'heure de 8 choses de ta journée",
    "Jeu de rôle : commande au restaurant, puis parle du temps",
    "Jeu de rôle : au marché (un kilo de, beaucoup de, pas de)",
    "Raconte un matin normal : je pars, je sors, je finis, je dors",
    "Parle de ce que tu sais faire et de qui tu connais",
    "Parle de tes loisirs et de ce que tu veux faire ce mois-ci",
    "Qu'est-ce que tu vas faire ce week-end ? Qu'est-ce que tu as fait hier ?",
    "Raconte ton arrivée en France",
    "Parle de ton enfance et de ta vie dans 10 ans",
    "Raconte ta vie : j'habite, j'ai habité, je vais habiter",
    "Jeu de rôle : demande ton chemin, puis pose 8 questions à Claude",
    "Raconte une journée où rien ne marche : je n'ai pas…, je n'ai rien…",
    "Jeu de rôle : au marché avec en et le, la, les : j'en prends deux, je le prends",
    "BILAN : présente-toi 3 min sans notes, enregistre-toi, compare avec le jour 1",
]
# Everyday French to read, one per Débutant study day, using that day's grammar where it can.
R1 = [
    "signs around you: ouvert, fermé, entrée, sortie, poussez, tirez",
    "food packets: find 5 adjectives (grand, petit, frais, bio, nouveau…)",
    "notices with ne… pas: ne pas fumer, ne pas toucher, ne pas entrer",
    "a supermarket leaflet: find 10 products you can name",
    "shop and aisle signs: note 8 words with un or une",
    "street signs: centre-ville, gare, mairie, à la…, au…",
    "a real form: nom, prénom, date de naissance, adresse, signature",
    "a pharmacy window or medicine box: mal de tête, douleur, fièvre",
    "rules on a door or a bus: pas de…, il n'y a pas de…",
    "a neighbourhood map: à côté de, près de, loin de, devant",
    "a flat-rental ad: il y a, cuisine, chambre, meublé, charges",
    "restaurant reviews: c'est bon, c'est cher, c'est beau",
    "opening hours and a train timetable: lundi, 8 h 30, départ, arrivée",
    "a weather forecast and a restaurant menu",
    "price tags at a market: le kilo, le litre, moins cher, plus cher",
    "cinema listings: le film, la séance, la durée, finit à",
    "a library or school notice: inscription, horaires, à savoir",
    "a leaflet for local activities: cours de…, faire du sport, on peut",
    "an event poster: demain, ce week-end, vous allez…",
    "a short post or message in the past: j'ai visité, je suis allé(e)",
    "a horoscope: tu seras, tu auras, vous aurez",
    "a short biography on Vikidia: il est né en…, depuis, il y a",
    "a shop's FAQ page: où, quand, comment, combien, pourquoi",
    "building or park rules: ne… jamais, rien, personne, plus de",
    "a short recipe: find en, y, le, la, les",
    "a short article for learners: find 5 uses of qui and que",
]
# Everyday topics the word deck and Vincent leave thin, added as one-tap flashcards: words in site/logic.js.
WORD_SET_DAYS = {7: "clothes", 18: "transport"}

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


# ---------- Débutant, from the book's contents pages ----------
# One study day per entry (first chapter, last chapter). Follows the pages and topics: each -er, avoir, numbers
# and passé composé group stays together, and no day runs past 8 pages.
DEB_DAYS = [(1, 2), (3, 4), (5, 6), (7, 9), (10, 11), (12, 13), (14, 16), (17, 18), (19, 20), (21, 23), (24, 25),
            (26, 27), (28, 29), (30, 31), (32, 34), (35, 36), (37, 39), (40, 42), (43, 44), (45, 46), (47, 48),
            (49, 50), (51, 52), (53, 54), (55, 57), (58, 60)]
# First page of chapters 1 to 60.
DEB_START = [8, 10, 14, 16, 18, 20, 22, 24, 26, 30, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 56, 58, 60, 62, 64, 66, 68,
             72, 76, 78, 80, 82, 84, 86, 90, 92, 94, 96, 98, 100, 102, 104, 108, 110, 112, 114, 118, 120, 122, 126,
             128, 130, 132, 134, 138, 140, 142, 144, 146, 148]
# (bilan number, last chapter it covers, first page). Recap exercises and the test take 2 pages.
DEB_BILANS = [(1, 9, 28), (2, 20, 54), (3, 27, 70), (4, 34, 88), (5, 42, 106), (6, 49, 124), (7, 54, 136), (8, 60, 150)]
# Short topic per chapter, in our own words. Index 0 is chapter 1.
DEB_TOPICS = [
    "introducing yourself: nationality, job",
    "describing: masculine and feminine adjectives",
    "describing: plural adjectives",
    "être; tu or vous; nous or on",
    "yes/no questions; ne… pas",
    "-er verbs; aimer",
    "-er verbs: the full present",
    "-er verbs: spelling changes",
    "reflexive -er verbs",
    "nouns: gender and articles",
    "nouns: plural",
    "un, une, des; le, la, les",
    "au, à la, aux; du, de la, des",
    "mon, ton, son",
    "ce, cette, ces",
    "avoir + noun; where adjectives go",
    "looks and age",
    "aches, hunger, cold",
    "avoir: the full present",
    "pas le, pas la; pas de",
    "place: à, de, chez, près de, loin de",
    "cities and countries: à, au, en",
    "dans, sur, sous, devant, derrière",
    "il y a; il n'y a pas de",
    "qui est-ce, qu'est-ce que c'est; ce n'est pas",
    "c'est or il est",
    "c'est + adjective: general comments",
    "numbers, dates, days",
    "telling the time",
    "weather, months, seasons",
    "du, de la, des: some",
    "amounts: un kilo de, beaucoup de, pas de",
    "comparing: plus, moins, aussi",
    "comparing amounts; superlatives",
    "-ir verbs like finir",
    "-ir verbs like partir",
    "-re verbs like écrire",
    "savoir, connaître, croire, voir",
    "three-form verbs like boire",
    "vouloir, pouvoir, devoir + infinitive",
    "faire and dire",
    "aller",
    "near future: je vais + verb",
    "passé composé with avoir: -er verbs",
    "passé composé with avoir: other verbs",
    "passé composé with être",
    "imparfait",
    "simple future",
    "present, past, future: overview",
    "il y a, pendant, depuis, dans",
    "questions: où, quand, comment, combien, pourquoi",
    "questions: qui, que, quel",
    "ne… rien, jamais, plus, personne",
    "negatives and questions in the passé composé",
    "the pronoun en",
    "the pronoun y",
    "le, la, les: direct object pronouns",
    "lui, leur: indirect object pronouns",
    "moi, toi, lui: stressed pronouns",
    "qui and que: relative pronouns",
]
assert sum(hi - lo + 1 for lo, hi in DEB_DAYS) == len(DEB_START) == len(DEB_TOPICS) == 60


# A short English note per chapter, written for this plan (not a translation of the book). Read before the left page.
DEB_BRIEFS = [
    "Say who you are with je suis + name, nationality or job: je suis Anna, je suis anglais. No word for 'a' before a job: je suis professeur. Vous êtes… ? is the polite 'are you…?'.",
    "Adjectives agree with the person. Feminine usually adds -e, and you then hear the last consonant: grand, grande. Words already ending in -e don't change: jeune. Patterns to spot: -en → -enne, -er → -ère, -eux → -euse, -if → -ive. Il = he, elle = she.",
    "Plural adds an -s you don't hear: grand, grands; grande, grandes. Words ending in -s or -x don't change. Ils = they (male or mixed group), elles = they (all female). A mixed group takes the masculine.",
    "être: je suis, tu es, il/elle/on est, nous sommes, vous êtes, ils/elles sont. Tu is for friends, family and children; vous for strangers, work, or several people. On is everyday French for 'we', and takes the il form: on est.",
    "Yes/no questions: raise your voice (Vous êtes français ?) or start with Est-ce que. The negative wraps the verb: je ne suis pas. Ne becomes n' before a vowel: il n'est pas.",
    "Most verbs end in -er. With je the ending is a silent -e (je parle); with vous it's -ez (vous parlez). Aimer takes a noun with le, la, les (j'aime le café) or a second verb (j'aime danser).",
    "The full present: je parle, tu parles, il parle, nous parlons, vous parlez, ils parlent. The -e, -es, -e and -ent endings are silent, so four forms sound the same. Je becomes j' before a vowel: j'aime.",
    "Some -er verbs change spelling to keep their sound: j'achète but nous achetons; je préfère but vous préférez; j'appelle; nous mangeons; nous commençons; je paie.",
    "Reflexive verbs carry a little pronoun: je me lave, tu te laves, il se lave, nous nous lavons, vous vous lavez, ils se lavent. English often drops it: je me lève = I get up. Me, te, se become m', t', s' before a vowel.",
    "Every noun is masculine or feminine, so learn it with its article: un homme, une femme. People often add -e: un ami, une amie. Clues: -tion is usually feminine; -age and -ment are usually masculine.",
    "Plural adds an -s you don't hear: un arbre, des arbres, so listen to the article instead. Nouns ending in -s, -x or -z don't change. -eau → -eaux; -al → -aux (un journal, des journaux).",
    "Un, une, des = a, some: one of many, or first mention. Le, la, les = the: something specific, or a thing in general. L' before a vowel. French keeps the article where English drops it: j'aime le café.",
    "À and de merge with le and les: à + le = au, à + les = aux, de + le = du, de + les = des. À la, à l', de la and de l' don't change: je vais au cinéma, à la gare.",
    "Possessives agree with the thing owned, not the owner: mon père, ma mère, mes parents; ton, ta, tes; son, sa, ses (son père = his or her father); notre, nos; votre, vos; leur, leurs. Before a vowel, ma becomes mon: mon amie.",
    "This, that, these, those: ce chat, cet arbre (masculine before a vowel), cette voiture, ces arbres. It also works with time: ce soir = this evening.",
    "Avoir + noun says what you have: j'ai une voiture. Most adjectives go after the noun: une voiture rouge. Short common ones go before: belle, grand, petit, bon, jeune, vieux: une belle voiture.",
    "French uses avoir for looks and age: il a les yeux noirs. Age is always avoir: mon fils a trois ans means 'my son is three'.",
    "Avoir mal à + body part: j'ai mal à la tête, au dos, aux dents. Feelings use 'have', where English uses 'be': j'ai faim, soif, froid, chaud, peur, sommeil.",
    "avoir: j'ai, tu as, il/elle/on a, nous avons, vous avez, ils/elles ont. Questions and negatives work as with être: Est-ce que vous avez… ? Je n'ai pas… Hear the difference: ils ont (z sound), ils sont (s sound).",
    "After a negative, un, une and des become de: j'ai une voiture → je n'ai pas de voiture. Le, la, les don't change: je n'aime pas le café.",
    "À = at or in a city; de = from: je suis de Delhi, je suis à Paris. Chez + person = at someone's place: chez Paul, chez moi. Près de = near, loin de = far from.",
    "Cities take à: à Paris. Feminine countries (most ending in -e) take en: en France. Masculine ones take au: au Japon. Plural ones take aux: aux États-Unis.",
    "Dans = in, sur = on, sous = under, devant = in front of, derrière = behind. They work like English, with an article after them: sur la table.",
    "Il y a = there is and there are, always the same form. Qu'est-ce qu'il y a ? = what is there? Negative: il n'y a pas de… (des becomes de after pas).",
    "For people: Qui est-ce ? C'est Paul. For things: Qu'est-ce que c'est ? C'est un livre. Plural: ce sont. Here un stays after the negative: ce n'est pas un chat. (Compare chapter 20.)",
    "C'est + article + noun: c'est un acteur. Il est + adjective: il est grand. It's the same for things. Jobs work both ways: il est médecin, but c'est un médecin.",
    "C'est + masculine adjective makes a general comment, even about a feminine or plural thing: la France, c'est beau; les voyages, c'est cher.",
    "Watch 70 = soixante-dix, 80 = quatre-vingts, 90 = quatre-vingt-dix. Ordinals: premier, première, deuxième, troisième. Dates: le 3 mai, but le premier mai. Lundi = this Monday; le lundi = every Monday.",
    "Il est + heures: il est cinq heures. Et quart = quarter past, et demie = half past, moins le quart = quarter to. Midi = noon, minuit = midnight. À 8 heures = at 8 o'clock.",
    "Weather uses il fait: il fait froid, il fait beau. Also il pleut, il neige. Months and seasons take en: en janvier, en été, en hiver. The exception: au printemps.",
    "Du, de la, de l', des = 'some', for amounts you don't count: je mange du pain, de la salade, des fruits. English can drop 'some'; French can't. After aimer, use le, la, les instead: j'aime le pain.",
    "After an amount, use de with no article: un kilo de tomates, un litre de lait, beaucoup de sucre, un peu de sel. Pas de works the same way.",
    "Plus, moins or aussi + adjective + que: plus grand que, moins cher que, aussi beau que. Two irregular ones: bon → meilleur, bien → mieux.",
    "For amounts: plus de, moins de, autant de + noun: plus de livres que… The superlative adds le, la, les: le plus grand, la moins chère, le meilleur.",
    "Finir type: je finis, tu finis, il finit, nous finissons, vous finissez, ils finissent. The singular endings sound the same; the plural adds -iss-.",
    "Partir type: je pars, tu pars, il part, nous partons, vous partez, ils partent. The singular drops the consonant before the ending. The same goes for dormir (je dors) and sortir (je sors).",
    "Two stems: j'écris, tu écris, il écrit, but nous écrivons, vous écrivez, ils écrivent. Lire works the same way (je lis, nous lisons). Learn the nous form with the verb.",
    "Savoir = know a fact or how to do something: je sais nager. Connaître = know a person or place: je connais Paris. Je sais, nous savons; je connais, nous connaissons; je crois, nous croyons; je vois, nous voyons.",
    "Three stems: je bois, nous buvons, ils boivent. The same pattern: je viens, nous venons, ils viennent; je prends, nous prenons, ils prennent. Learn the je, nous and ils forms together.",
    "Je veux, nous voulons, ils veulent. Je peux, nous pouvons, ils peuvent. Je dois, nous devons, ils doivent. The next verb follows directly, with no 'to': je veux partir. Il faut + verb = you must.",
    "Faire: je fais, tu fais, il fait, nous faisons, vous faites, ils font. Activities: faire du tennis, de la musique, la cuisine. Dire: je dis, nous disons, vous dites, ils disent.",
    "Aller: je vais, tu vas, il va, nous allons, vous allez, ils vont. Places: à Rome, au cinéma. Transport: en bus, en train, but à pied.",
    "Aller + verb = going to do something: je vais manger. The negative wraps aller: je ne vais pas manger. Use this for most everyday future plans.",
    "The passé composé is the main past tense: avoir + participle. -er verbs end in -é: j'ai mangé. This one form covers both 'I ate' and 'I have eaten'.",
    "Other participles to learn: finir → fini, vendre → vendu, voir → vu, avoir → eu, être → été, faire → fait, prendre → pris, mettre → mis, boire → bu, lire → lu.",
    "About 15 verbs, mostly of movement, use être: aller, venir, arriver, partir, entrer, sortir, monter, descendre, naître, mourir, rester, tomber; so do all reflexive verbs. The participle then agrees like an adjective: il est arrivé, elle est arrivée, ils sont arrivés.",
    "The imparfait is for description and habits: 'was doing', 'used to do'. Take the nous form, drop -ons, and add -ais, -ais, -ait, -ions, -iez, -aient: nous parlons → je parlais. The exception: être → j'étais.",
    "The simple future: infinitive + -ai, -as, -a, -ons, -ez, -ont: je parlerai. Irregular stems: être → ser-, avoir → aur-, aller → ir-, faire → fer-, venir → viendr-. After quand, French uses the future where English uses the present: quand je serai grand.",
    "A review of the tenses so far: je mange, j'ai mangé, je mangeais, je vais manger, je mangerai. Notice how time words point to each one: hier, maintenant, demain.",
    "Il y a + time = ago: il y a deux ans. Pendant = for a finished period. Depuis = since or for, with something still going on, in the present: j'habite ici depuis deux ans. Dans + time = in (the future): dans deux jours.",
    "Où, quand, comment, combien, pourquoi. Three styles: Tu vas où ? (spoken), Où est-ce que tu vas ? (standard), Où vas-tu ? (formal). Answer pourquoi with parce que.",
    "Qui = who. Que or qu'est-ce que = what. Quel, quelle, quels, quelles = which or what, and they agree with the noun: Quelle est votre profession ?",
    "These replace pas, and ne stays: ne… rien = nothing, ne… jamais = never, ne… plus = no longer, ne… personne = no one: je ne mange rien. Rien and personne can also start a sentence: personne ne sait.",
    "In the passé composé, the negative wraps the auxiliary: je n'ai pas mangé, je ne suis pas sorti. Questions: Est-ce que tu as mangé ? or, more formally, As-tu mangé ?",
    "En replaces du, de la, des, or a noun after a number or amount, and goes before the verb: Tu manges du pain ? Oui, j'en mange. J'en veux deux.",
    "Y replaces a place you're going to or are in, and goes before the verb: Tu vas au cinéma ? Oui, j'y vais.",
    "Le, la, l', les replace a direct object and go before the verb: je regarde Paul → je le regarde. Word for word, that's 'I him watch'. The negative wraps both: je ne le regarde pas.",
    "Lui and leur replace à + a person: il parle à Marie → il lui parle. Lui means both 'to him' and 'to her'. They go with verbs like parler à, téléphoner à, donner à.",
    "Moi, toi, lui, elle, nous, vous, eux, elles. Use them after prepositions (avec moi, chez lui), after c'est (c'est moi), and for emphasis: moi, je reste.",
    "Both link two ideas. Qui is the subject of the next verb: le train qui arrive. Que is its object: le train que je prends. Que becomes qu' before a vowel; qui never shortens.",
]
assert len(DEB_BRIEFS) == 60

# Lessons that explain the day's grammar come before the book. Word lists stay in the afternoon, with anything "(extra)".
VINCENT_AFTERNOON = {
    "Jobs", "Family words", "Marital status", "Colours", "Countries: Europe", "Countries: the Americas",
    "Countries: Middle East", "Countries: Far East", "The house", "The living room", "The kitchen", "In town",
    "In the house", "Geography words", "Fruit and vegetables", "Cooking", "Courses of a meal", "At the café",
    "At the restaurant", "Food words", "Fish", "Grains", "Climates", "The body: the mouth", "Metres, litres, kilos",
}


def deb_pages(lo, hi):
    """Pages of chapters lo..hi, e.g. 'p. 14–17', or 'p. 122–123, 126–127' when a bilan falls between them."""
    runs = []
    for ch in range(lo, hi + 1):
        first = DEB_START[ch - 1]
        bilan = next((p for _n, last, p in DEB_BILANS if last == ch), None)
        end = bilan - 1 if bilan else DEB_START[ch] - 1
        if runs and runs[-1][1] + 1 == first:
            runs[-1][1] = end
        else:
            runs.append([first, end])
    return "p. " + ", ".join(f"{a}–{b}" for a, b in runs)


def deb_topics_text(t):
    """'Déb. 1–2: topic; topic' for a chapter tuple from Débutant, otherwise None."""
    if not t or t[0] != "Déb.":
        return None
    return f"{ch_label(t)}: " + "; ".join(DEB_TOPICS[ch - 1] for ch in range(t[1], t[2] + 1))


# chapter assignment: day -> (code, first, last)
chapters = {}
for code, _name, n, a, b in BOOKS:
    days = study_days(a, b)
    if code == "Déb.":
        assert len(days) == len(DEB_DAYS)
        for d, (lo, hi) in zip(days, DEB_DAYS):
            chapters[d] = (code, lo, hi)
        continue
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
assert len(_vdays) >= _units and len(R1) == 26
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


YOUTUBE_MINUTES = 60  # the phase 1 YouTube slot in site/logic.js

YOUTUBE_MINUTES = 60  # the phase 1 YouTube slot in site/logic.js

# Vincent, "Learn French in 5 Days - The Legacy Version" (playlist PLdR5FaFp7N5M): video id, length (s), parts.
# 256 lessons. Every start and topic was checked against the full transcript and the lesson's own title slide.
# Four long lessons are cut where they leave the chapter's topic (marked "cut"), so a link can stop there.
# Each part: start (s), topic, and where it is watched: a Débutant chapter, "sun" (Sunday 6 Dec, with the
# Annexes), or a later phase by level: "p2" (Intermédiaire) or "p3" (Avancé), in table order. Move those onto
# their chapters' days once the books' contents are in.
# "(extra)" = useful, but not on that day's grammar: pronunciation and word lists placed on days with room.
_X = " (extra)"
_MATCH = "Words that match English" + _X
_PC = "Passé composé, verb by verb"
_SPELL = "-er verbs: spelling changes"
_FOOD = "Food words"
_VP = "Verbs and prepositions"
VINCENT = [
    ("keBSvVsEibI", 15015, [
        (0, "Vowels", 1), (202, "Consonants", 1), (470, "Accents", 1), (742, "Special characters", 1), (969, "être", 4),
        (1530, "avoir", 19), (1841, "aller", 42), (2205, "s'appeler", 1), (2639, "Introducing yourself", 1),
        (2809, "le, la, les", 12), (3072, "un, une, des", 12), (3351, "quel, quelle", 52),
        (3669, "Days and months", 28), (4288, "Jobs: masculine and feminine", 1), (4653, "Vowel combinations" + _X, 3),
        (4980, "Numbers 0–9", 28), (5154, "Numbers 10–20", 28), (5380, "mon, ma, mes", 14),
        (5908, "moi, toi, lui", 59), (6367, "quand, où, comment, combien", 51), (6733, "faire", 41), (6910, "ne… pas", 5),
        (7183, "ce, cette, ces", 15), (7417, "Regular -er verbs", 7), (7758, "Numbers 20–50", 28), (8032, "venir", 39),
        (8220, "Family words", 14), (8582, "qui, que, quoi", 52), (8887, "Asking someone's name", 1),
        (9206, "Marital status", 14), (9469, "Regular -ir verbs", 35), (9746, "Plurals", 11), (10386, "pouvoir", 40),
        (10679, "devoir", 40), (10926, "Countries: Europe", 22), (11371, "Nationalities", 1),
        (11852, "Countries: the Americas", 22), (12160, "attendre", 37), (12526, "répondre", 37), (12713, "tu or vous", 4),
        (13042, "Yesterday, today, tomorrow", 43), (13250, "Numbers 50–75", 28), (13602, "Numbers 75–100", 28),
        (13924, "parce que", 51), (14197, "Countries: Middle East", 22), (14398, "Countries: Far East", 22),
        (14602, "Reflexive verbs", 9),
    ]),
    ("QzY_nYZ0RSQ", 16978, [
        (0, "Near future", 43), (439, "Noun gender", 10), (775, "du, de la, des", 31), (1119, "pourquoi", 51),
        (1304, "Where is it? sur, sous, dans", 23), (1575, "Here, there, over there", 23), (1859, "il faut", 40),
        (2081, "First, second, third", 28), (2275, "partir", 36), (2422, "venir, second take", "p2"),
        (2596, "Direct objects", 57), (3226, "Indirect objects", 58), (3807, "vouloir", 40), (3935, "savoir", 38),
        (4076, "il y a", 24), (4378, "Passé composé", 44), (5658, "Past participles", 45),
        (6345, "Telling the time", 29), (6815, "The house", 24), (7004, "Adjectives: where they go", 16),
        (7997, "Three ways to ask a question", 51), (8601, "Passé composé of avoir", 45),
        (8758, "Passé composé of être", 45), (8888, "Passé composé of aller", 45), (9082, "Passé composé of parler", 44),
        (9182, "Passé composé of finir", 45), (9315, "Metres, litres, kilos", 32), (9427, "False friends" + _X, 53),
        (9614, "The body", 18), (9948, "The face", 17), (10247, "Time words: last week, next week", 49),
        (10507, "Expressing quantity", 32), (11089, "Colours", 2), (11327, "Impersonal il", 30),
        (11665, "ce, cet, cette, ces in depth", 15), (11989, "celui, celle (cut)", "sun"),
        (12202, "c'est + adjective", 27), (12594, "The living room", 24), (12741, "The kitchen", 24),
        (12984, "Fruit and vegetables", 31), (13372, "Comparatives", 33), (13933, _PC, 45), (14056, _PC, 45),
        (14230, _PC, 45), (14344, _PC, 45), (14462, _PC, 45), (14564, _PC, 45), (14708, _PC, 45),
        (14829, "Simple future", 48), (15426, "The pronoun en", 55), (16384, "The pronoun y", 56),
    ]),
    ("12YUmS3rNr8", 28105, [
        (0, "Adverbs", 53), (574, "Adverbs in -ment", 53), (1146, "In town", 24), (1600, "In the house", 24),
        (1883, "savoir or connaître", 38), (2399, "Conditional", "p2"), (3424, "Ordinal numbers", 28),
        (3636, "Conditional: être", "p2"), (3780, "Conditional: avoir", "p2"), (3955, "Conditional: aller", "p2"),
        (4119, "lequel, laquelle", "p2"), (4558, "Jobs", 1), (5274, "Cooking", 31), (5551, "Courses of a meal", 31),
        (5728, "Past conditional", "p3"), (6982, "Beauty and hygiene" + _X, 18), (7402, "Useful verbs (1)" + _X, 6),
        (7795, "Useful verbs (2)" + _X, 6), (8112, "At the café", 31), (8317, "At the restaurant", 31),
        (8471, "Fish", 32), (8637, "Grains", 32), (8733, "Imparfait", 47), (9567, "Imparfait or passé composé", 49),
        (10419, "Passive", "p3"), (10961, "Passive: conjugation", "p3"), (11466, "Geography words", 24),
        (11801, "Weather", 30), (12009, "Climates", 30), (12126, "Plus-que-parfait", "p2"),
        (13042, "Relative pronouns: qui, que", 60), (13690, "Relative pronouns: agreement, dont, où (cut)", "p2"),
        (14648, "Two pronouns: en", "p2"), (15131, "Two pronouns: le, la, les", "p2"), (15586, "Present continuous", "p2"),
        (15976, "Recent past: venir de", 49), (16316, "Near future, review", 43), (16621, "Future perfect", "p3"),
        (17753, "Articles after a negative", 20), (18359, "108 adjectives" + _X, 26), (19348, "100 adjectives" + _X, 37),
        (20336, "120 adjectives" + _X, 35), (21656, "à and de with articles", 13), (22342, "The preposition à", 21),
        (23387, "The preposition de", 21), (23928, "The preposition en", 22), (24380, "en + -ant (cut)", "p3"),
        (24529, "avoir or être + participle", 46), (24774, "Other compound tenses (cut)", "p3"),
        (25230, "Imperative", "sun"), (26438, "Liaison: required" + _X, 5), (26991, "Liaison: forbidden" + _X, 10),
        (27733, "Liaison: optional" + _X, 11),
    ]),
    ("ppYImLa36ug", 17995, [
        (0, "Subjunctive", "p3"), (1389, "Past subjunctive", "p3"), (2500, "Subjunctive with conjunctions", "p3"),
        (2762, "Subjunctive: opinion, doubt", "p3"), (3016, "Subjunctive: feelings", "p3"),
        (3301, "Subjunctive: advice, wishes, orders", "p3"), (3585, "Subjunctive: negative structures", "p3"),
        (3822, "Present participle", "p3"), (4349, "Gerund", "p3"), (4775, "Superlative", 34),
        (5308, "Superlative with a noun", 34), (5449, "si clauses", "p2"), (5935, "Indirect speech", "sun"),
        (6430, "Indirect speech: time words", "p3"), (6643, "Indirect speech: sentence changes", "p3"),
        (7312, "Indirect speech: tense changes", "p3"), (8238, "Verbs with que + indicative", "p3"),
        (8592, "Verbs that take être", 46), (8905, "Homographs", "p3"), (9191, "Homophones", "p3"),
        (9489, "Homophones", "p3"), (9766, "Homophones", "p3"), (9977, "Homophones", "p3"), (10234, "Prefixes", "p3"),
        (10417, "Prefixes", "p3"), (10681, "Prefixes", "p3"), (10897, "Prefixes", "p3"), (11053, "Suffixes", "p3"),
        (11286, "Suffixes", "p3"), (11534, "Suffixes", "p3"), (11707, _MATCH, 12), (11977, _MATCH, 12),
        (12206, _MATCH, 12), (12406, _MATCH, 12), (12600, _MATCH, 17), (12819, _MATCH, 17), (13005, _MATCH, 17),
        (13189, _MATCH, 17), (13411, _MATCH, 17), (13590, _MATCH, 17), (13769, _MATCH, 17),
        (14004, "The body: the mouth", 18), (14399, "Shortened words", "p3"), (14678, "Verbs with prefixes", "p3"),
        (14982, "Verbs with prefixes", "p3"), (15296, "Verbs with prefixes", "p3"), (15389, "Verbs with prefixes", "p3"),
        (15478, "Verbs with prefixes", "p3"), (15541, "Verbs with prefixes", "p3"), (15662, "Verbs with prefixes", "p3"),
        (15749, "Verbs with prefixes", "p3"), (15850, "Verbs with prefixes", "p3"), (16052, "Verbs with prefixes", "p3"),
        (16219, "Verbs with prefixes", "p3"), (16352, "Verbs with prefixes", "p3"), (16493, "Verbs with prefixes", "p3"),
        (16696, _MATCH, 49), (16943, _MATCH, 49), (17205, _MATCH, 49), (17485, _MATCH, 49), (17640, _MATCH, 49),
        (17791, _MATCH, 49),
    ]),
    ("b1sXCZDuxSY", 14074, [
        (0, _MATCH, 53), (255, _MATCH, 53), (538, "Where adverbs go in the past", 53), (747, "Adverb phrases", "p2"),
        (1080, "Adverb phrases", "p2"), (1269, "Opposites", "p2"), (1546, "Opposites", "p2"), (1760, "Uses of faire", 41),
        (2070, "Adverb phrases", "p2"), (2356, "Adverb phrases", "p2"), (2513, "Adverb phrases", "p2"),
        (2686, _FOOD, 31), (2943, _FOOD, 31), (3236, _FOOD, 31), (3391, _FOOD, 31), (3571, _FOOD, 31), (3765, _FOOD, 31),
        (3987, _FOOD, 31), (4149, "Plurals of compound nouns", "p2"), (4459, "Plurals of compound nouns", "p2"),
        (4733, "Plurals of compound nouns", "p2"), (5017, "Plurals of compound nouns", "p2"), (5260, "Silent e" + _X, 3),
        (5838, "Medical words", "p2"), (5959, "Medical words", "p2"), (6265, "Medical words", "p2"), (6414, _VP, "p2"),
        (6851, "Present participle or verbal adjective", "p3"), (7125, _VP, "p2"), (7732, _VP, "p2"), (8293, _VP, "p2"),
        (8926, "Past participles that never change", "p3"), (9341, _SPELL, 8), (9653, _SPELL, 8), (9968, _SPELL, 8),
        (10191, _SPELL, 8), (10481, _SPELL, 8), (10864, _SPELL, 8), (11145, _SPELL, 8), (11462, _SPELL, 8),
        (11742, "Exclamations: adjectives", "p2"), (12000, "Exclamations: adverbs", "p2"), (12173, "Interjections", "p2"),
        (12326, _VP, "p2"), (12718, _VP, "p2"), (13304, _VP, "p2"), (13666, _VP, "p2"),
    ]),
]
assert [len(v[2]) for v in VINCENT] == [47, 51, 53, 62, 47]


# The book's recordings (p. 158–172), one list per study day (1–26). The book tags each dialogue with its grammar
# and keys the songs on p. 172. AUDIO_NEEDS is the last chapter that grammar needs: a recording never comes before
# it, and dialogues stay in the book's own order.
AUDIO_DAYS = {
    3: [29], 4: [30], 9: [1, 2, 3, 4, 31], 11: [5, 6, 7], 12: [8], 13: [9, 10], 15: [11, 12, 13], 16: [14, 15],
    17: [16, 32], 18: [17, 18], 19: [19, 20, 21, 33], 20: [22, 23], 21: [24, 25, 26, 27, 28, 34, 36], 23: [35],
    24: [37], 26: [38],
}
AUDIO_NEEDS = {
    1: 19, 2: 19, 3: 19, 4: 19, 5: 19, 6: 19, 7: 19, 8: 19,  # être, avoir, greetings, adjectives, aimer
    9: 28, 10: 28, 11: 29, 12: 29, 13: 29,  # questions, numbers, il y a, times
    14: 9, 15: 9,  # questions and -er verbs
    16: 39, 17: 40, 18: 40, 19: 43,  # -ir/-re/-oir, vouloir + infinitive, near future
    20: 44, 21: 44, 22: 46, 23: 46, 24: 45, 25: 45,  # passé composé
    26: 47, 27: 48, 28: 48,  # imparfait, simple future
    29: 6, 30: 9, 31: 20, 32: 39, 33: 44, 34: 44, 35: 52, 36: 48, 37: 53, 38: 0,  # songs, from the key on p. 172
}
SONG_TITLES = {29: "Je parle français", 30: "C'est dur", 31: "Oui et non", 32: "Quand tu pleures",
               33: "Ah, quelle journée !", 34: "C'est ma vie", 35: "Ça, c'est la question", 36: "Votez pour moi",
               37: "Bonnes résolutions", 38: "Ma langue"}
DIALOGUE_PAGES = [158, 158, 158, 158, 159, 159, 159, 160, 161, 161, 162, 162, 162, 163, 163, 164, 165, 165, 165, 166,
                  166, 167, 167, 168, 168, 169, 169, 169]
AUDIO_MINUTES_EACH = 5  # listen with the text covered, then following it, repeat aloud, do the page's questions
assert sorted(n for ns in AUDIO_DAYS.values() for n in ns) == list(range(1, 39))


def audio_title(ns):
    """E.g. 'Dialogues 1–4 (p. 158), song: Oui et non'."""
    parts = []
    dialogues = [n for n in ns if n <= 28]
    if dialogues:
        pages = sorted({DIALOGUE_PAGES[n - 1] for n in dialogues})
        where = f"p. {pages[0]}" if len(pages) == 1 else f"p. {pages[0]}–{pages[-1]}"
        names = f"Dialogue {dialogues[0]}" if len(dialogues) == 1 else f"Dialogues {dialogues[0]}–{dialogues[-1]}"
        parts.append(f"{names} ({where})")
    songs = [SONG_TITLES[n] for n in ns if n > 28]
    if songs:
        parts.append(("song: " if len(songs) == 1 else "songs: ") + ", ".join(songs))
    return ", ".join(parts)


# Annexes grammaticales (p. 152–153), read on the day after the chapters they build on. The rest of p. 153 goes on
# Sunday 6 Dec. There is no Vincent lesson on §3, §4 or §9.
DEB_ANNEX = {
    (49, 50): "Annexes §7, p. 153: passé récent",
    (53, 54): "Annexes §1–3, p. 152: adverbs, where adverbs and negatives go",
    (58, 60): "Annexes §4, p. 152: where object pronouns go",
}
ANNEX_SUNDAY = date(2026, 12, 6)
ANNEX_SUNDAY_ITEM = ("Annexes §5, §6, §8, §9, p. 153 (45 min): imperative, indirect speech, demonstrative and possessive "
                     "pronouns. Read each one, then watch Vincent's lessons")


def hms(sec):
    return f"{sec // 3600}:{sec % 3600 // 60:02d}:{sec % 60:02d}"


def vincent_parts():
    """Every part of the course, grouped by where it is watched, in table order."""
    groups = {}
    for v, (vid, length, lessons) in enumerate(VINCENT):
        starts = [st for st, _t, _h in lessons]
        assert starts == sorted(starts) and starts[0] == 0
        for j, (st, topic, home) in enumerate(lessons):
            end = starts[j + 1] if j + 1 < len(starts) else length
            groups.setdefault(home, []).append(
                {"video": v + 1, "id": vid, "from": st, "to": end, "topics": [topic.replace(" (cut)", "")]})
    return groups


def is_first(seg):
    """Watch before the book: lessons on the day's grammar, not word lists or extras."""
    return not any("(extra)" in t or t in VINCENT_AFTERNOON for t in seg["topics"])


def links_for(segments):
    """Links for a run of parts, joined where they run on in the same video."""
    links = []
    for seg in segments:
        prev = links[-1] if links else None
        if prev and prev["id"] == seg["id"] and prev["to"] == seg["from"] and is_first(prev) == is_first(seg):
            prev["to"] = seg["to"]
            prev["topics"] += [t for t in seg["topics"] if t not in prev["topics"]]
        else:
            links.append({**seg, "topics": list(seg["topics"])})
    return [{"video": g["video"], "id": g["id"], "from": g["from"], "to": g["to"],
             "topic": ", ".join(g["topics"]), "first": is_first(g)} for g in links]


def vincent_days(days, by_chapter):
    """Each Débutant study day's lessons: those on its chapters."""
    out = {}
    for i, d in enumerate(days, 1):
        _code, lo, hi = chapters[d]
        links = links_for([seg for ch in range(lo, hi + 1) for seg in by_chapter.get(ch, [])])
        audio = AUDIO_DAYS.get(i, [])
        for n in audio:
            assert AUDIO_NEEDS[n] <= hi, f"audio {n} on day {i} needs chapter {AUDIO_NEEDS[n]}"
        audio_min = len(audio) * AUDIO_MINUTES_EACH
        minutes = round(sum(g["to"] - g["from"] for g in links) / 60)
        rest = max(0, YOUTUBE_MINUTES - minutes - audio_min)
        rest = rest if rest >= 5 else 0  # not worth opening another video
        then = f", then Super Easy French ({rest} min)" if rest else ""
        out[d] = {
            "text": f"Vincent ({minutes} min){then}",
            "links": links,
            "rest": rest,
            "audio": {"title": audio_title(audio), "items": audio, "minutes": audio_min} if audio else None,
        }
    return out


def vincent_later(days, parts):
    """Spread parts evenly over `days` in order, never splitting one: a part goes where its midpoint falls."""
    total = sum(g["to"] - g["from"] for g in parts)
    per_day, done = {}, 0
    for g in parts:
        length = g["to"] - g["from"]
        per_day.setdefault(days[int((done + length / 2) / total * len(days))], []).append(g)
        done += length
    return {d: links_for(segs) for d, segs in per_day.items()}


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
        return "Vincent lessons matched to the day's chapters (listed below), then Super Easy French: 1 hour together"
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


_vparts = vincent_parts()
assert set(k for k in _vparts if not isinstance(k, int)) == {"sun", "p2", "p3"}
vincent = vincent_days(study_days(BOOKS[0][3], BOOKS[0][4]), _vparts)
annex_links = links_for(_vparts["sun"])
later = {**vincent_later(study_days(BOOKS[1][3], BOOKS[1][4]), _vparts["p2"]),
         **vincent_later(study_days(BOOKS[2][3], BOOKS[2][4]), _vparts["p3"])}
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
        "yt_rest": vincent[d]["rest"] if d in vincent else None,
        "book_audio": vincent[d]["audio"] if d in vincent else None,
        "vincent_later": later.get(d),
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
        code, lo, hi = chapters[d]
        if code == "Déb.":
            row["book_pages"] = deb_pages(lo, hi)
            row["book_topics"] = [{"ch": c, "topic": DEB_TOPICS[c - 1], "note": DEB_BRIEFS[c - 1]} for c in range(lo, hi + 1)]
            if (lo, hi) in DEB_ANNEX:
                row["book_annex"] = DEB_ANNEX[(lo, hi)]
    else:
        row["book"] = "Error-log chapters: redo the 2 weakest (any volume)"
    # writing + speaking
    if ph == 1:
        row["write"] = take(W1, "w1")
        row["speak"] = take(S1, "s1")
        row["read_task"] = R1[idx["w1"] - 1]
        if idx["w1"] in WORD_SET_DAYS:
            row["word_set"] = WORD_SET_DAYS[idx["w1"]]
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
        notes = []
        y = prev_study_day(d)
        if y in chapters and y >= START:
            parts.append(f"yesterday: {ch_label(chapters[y])}")
            notes.append(deb_topics_text(chapters[y]))
        w = d - timedelta(days=7)
        if w in chapters:
            parts.append(f"day −7: {ch_label(chapters[w])}")
            notes.append(deb_topics_text(chapters[w]))
        row["retest"] = " · ".join(parts) if parts else "nothing yet (first day)"
        if any(notes):
            row["retest_note"] = ". ".join(n for n in notes if n)
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
    bilans = [b for b in DEB_BILANS if any(c == "Déb." and lo <= b[1] <= hi for c, lo, hi in labs)]
    if bilans:
        names = " + ".join(f"Bilan {n} (p. {p}–{p + 1})" for n, _last, p in bilans)
        final = ", then the final test on p. 173" if bilans[-1][0] == 8 else ""
        items.append(f"Week re-test (60 min): {names}: recap exercises and test, no notes, then check the Corrigés"
                     f"{final}. With time left, 1 exercise from each of {span(labs)}{vtxt}")
        bilan_pages = [q for _n, _last, pg in bilans for q in (pg, pg + 1)] + ([173] if final else [])
        row["sunday_answer_pages"] = {str(len(items) - 1): bilan_pages}
    elif labs:
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
    if d == ANNEX_SUNDAY:
        items.append(ANNEX_SUNDAY_ITEM)
        row["sunday_links"] = {str(len(items) - 1): annex_links}
    row["sunday_items"] = items


# ---------- write Markdown ----------
PHASE_NAME = {1: "Débutant (A1)", 2: "Intermédiaire (A2→B1)", 3: "Avancé (B1→B2)", 4: "Exam mode (B2)"}
L = []
L.append("# French A1 → B2: day-by-day schedule")
L.append("")
L.append("Fri 6 Nov 2026 → Thu 6 May 2027 · at least 4 h/day · the full plan and the reasoning are in "
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
        book = f"{r['book']}, {r['book_pages']}" if r.get("book_pages") else r["book"]
        L.append(f"| {r['day']} | {book} | {r['write']} | {r['speak']} | {words} | {r['retest']} |")
    L.append("")
    vrows = [r for r in wk if r.get("yt_links")]
    if vrows:
        L.append("**Vincent this week (afternoon, matched to the day's chapters):**")
        for r in vrows:
            parts = []
            for l in r["yt_links"]:
                url = f"https://www.youtube.com/watch?v={l['id']}&t={l['from']}s"
                parts.append(f"[{l['topic']}]({url}) → stop at {hms(l['to'])}")
            rest = f"; then Super Easy French, {r['yt_rest']} min" if r["yt_rest"] else ""
            audio = f"; book audio: {r['book_audio']['title']}" if r["book_audio"] else ""
            L.append(f"- {r['day']}: {', '.join(parts)}{audio}{rest}")
        L.append("")
    lrows = [r for r in wk if r.get("vincent_later")]
    if lrows:
        L.append("**Vincent this week (afternoon, on top of the YouTube slot):**")
        for r in lrows:
            parts = [f"[{l['topic']}](https://www.youtube.com/watch?v={l['id']}&t={l['from']}s) → stop at {hms(l['to'])}"
                     for l in r["vincent_later"]]
            L.append(f"- {r['day']}: {', '.join(parts)}")
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
            topics = ": " + ", ".join(l["topic"] for l in r["yt_links"]) if r.get("yt_links") else ""
            w.writerow([r["date"], r["day"], r["phase"], r["book"], r["write"], r["speak"], r["retest"],
                        r["anki"], r["sent"], r["vocab"] or "", r["tv5"], r["yt"] + topics, "", ""])

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
if len(sys.argv) > 4:
    M = ["# Débutant: the book, Vincent and the audio, day by day", "",
         "Built from the book's contents, index and p. 152–172, with every Vincent lesson checked against its "
         "transcript and title slide. \"(extra)\" means useful but not on that day's grammar.", ""]
    for r in rows:
        if r["phase"] != 1 or r["sunday"]:
            continue
        M.append(f"## {r['day']}: {r['book']}, {r['book_pages']}")
        M.extend(f"- Ch. {t['ch']}: {t['topic']}" for t in r["book_topics"])
        if r.get("book_annex"):
            M.append(f"- {r['book_annex']}")
        for l in r["yt_links"]:
            M.append(f"- Vincent: {l['topic']} ({(l['to'] - l['from']) // 60} min), Day {l['video']} video "
                     f"{hms(l['from'])} → {hms(l['to'])}")
        if r["book_audio"]:
            M.append(f"- Audio: {r['book_audio']['title']}")
        M.append(f"- Everyday reading: {r['read_task']}")
        if r.get("word_set"):
            M.append(f"- New word set: {r['word_set']}")
        if r["yt_rest"]:
            M.append(f"- Super Easy French: {r['yt_rest']} min")
        M.append("")
    M.append("## Sun 6 Dec: Annexes §5, §6, §8, §9, p. 153")
    M.extend(f"- Vincent: {l['topic']} ({(l['to'] - l['from']) // 60} min), Day {l['video']} video "
             f"{hms(l['from'])} → {hms(l['to'])}" for l in annex_links)
    with open(sys.argv[4], "w", encoding="utf-8") as f:
        f.write("\n".join(M) + "\n")
watched = sum(l["to"] - l["from"] for slot in vincent.values() for l in slot["links"])
for key, name, n in (("p2", "Intermédiaire", 52), ("p3", "Avancé", 50)):
    secs = sum(g["to"] - g["from"] for g in _vparts[key])
    print(f"Vincent in {name}: {secs / 3600:.1f} h, about {secs / 60 / n:.0f} min a study day")
print(f"Vincent in Débutant: {watched / 3600:.1f} h")
print("Vincent minutes per day:", [round(sum(l["to"] - l["from"] for l in s["links"]) / 60) for s in vincent.values()])
print("Before the book, minutes per day:", [round(sum(l["to"] - l["from"] for l in s["links"] if l["first"]) / 60) for s in vincent.values()])
print("Hour used per day:", [round(sum(l["to"] - l["from"] for l in s["links"]) / 60) + (s["audio"]["minutes"] if s["audio"] else 0) + s["rest"] for s in vincent.values()])
