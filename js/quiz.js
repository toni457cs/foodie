/*
 * Onboarding quiz definition + display labels.
 * Questions 1–6 come straight from the empathy research; question 7 (vibes) is
 * optional and exists because "environment matters more than the food" was the
 * strongest pattern across all three interviews and the field test.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FoodieQuiz = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const CUISINES = [
    { value: 'american', label: 'American' },
    { value: 'italian', label: 'Italian & pizza' },
    { value: 'mexican', label: 'Mexican' },
    { value: 'chinese', label: 'Chinese' },
    { value: 'japanese', label: 'Japanese & sushi' },
    { value: 'thai', label: 'Thai' },
    { value: 'asian', label: 'Other Asian' },
    { value: 'indian', label: 'Indian' },
    { value: 'mediterranean', label: 'Mediterranean' },
    { value: 'cafe', label: 'Café & crêpes' },
    { value: 'brunch', label: 'Breakfast & brunch' },
    { value: 'seafood', label: 'Seafood' },
    { value: 'steak', label: 'Steak & BBQ' },
    { value: 'pub', label: 'Brewery & pub' },
    { value: 'vegetarian', label: 'Veggie & healthy' },
    { value: 'any', label: 'Surprise me' },
  ];

  const NOISE = [
    { value: 'quiet', label: 'Quiet', hint: 'Easy conversation' },
    { value: 'buzz', label: 'Light buzz', hint: 'Lively but relaxed' },
    { value: 'high', label: 'High energy', hint: 'Hip & loud is fine' },
  ];

  const DEALBREAKERS = [
    { value: 'no_parking', label: 'No parking' },
    { value: 'rude_service', label: 'Rude service' },
    { value: 'pricey', label: 'Too pricey' },
    { value: 'loud', label: 'Too loud' },
  ];

  const WAITS = [
    { value: 0, label: 'Seat me now' },
    { value: 15, label: 'Up to 15 min' },
    { value: 30, label: 'Up to 30 min' },
    { value: 60, label: 'Up to an hour' },
    { value: 999, label: "I'll wait for something great" },
  ];

  const COMPANY = [
    { value: 'solo', label: 'Just me' },
    { value: 'partner', label: 'Partner' },
    { value: 'friends', label: 'Friends' },
    { value: 'family', label: 'Family' },
    { value: 'coworkers', label: 'Coworkers' },
  ];

  const VIBES = [
    { value: 'views', label: 'Views & scenery' },
    { value: 'design', label: 'Beautiful design & lighting' },
    { value: 'patio', label: 'Outdoor seating' },
    { value: 'live_music', label: 'Live music' },
    { value: 'cozy', label: 'Cozy & intimate' },
    { value: 'local', label: 'Local art & character' },
  ];

  const QUIZ = [
    { id: 'name', type: 'text', prompt: 'First, what should we call you?', placeholder: 'Your first name' },
    {
      id: 'cuisines', type: 'multi', options: CUISINES, exclusive: 'any', max: 2,
      prompt: 'What food genre are you craving today?',
      hint: 'Pick up to 2.',
    },
    {
      id: 'novelty', type: 'single',
      prompt: 'Today, are you looking to…',
      options: [
        { value: 'favorites', label: 'Stick to favorites' },
        { value: 'new', label: 'Try something new' },
      ],
    },
    { id: 'noise', type: 'single', prompt: 'Ideal noise level?', options: NOISE },
    {
      id: 'dealbreakers', type: 'multi', options: DEALBREAKERS, optional: true, max: 2,
      prompt: 'Instant dealbreaker?',
      hint: 'Pick up to 2, or skip.',
    },
    { id: 'maxWait', type: 'single', prompt: 'How long will you wait for a table?', options: WAITS },
    { id: 'diningWith', type: 'single', prompt: 'Who are you dining with today?', options: COMPANY },
    {
      id: 'vibes', type: 'multi', options: VIBES, optional: true, max: 2,
      prompt: 'What makes a place feel special?',
      hint: 'Pick up to 2, or skip.',
    },
  ];

  const label = (list) => Object.fromEntries(list.map((o) => [o.value, o.label]));

  return {
    QUIZ,
    LABELS: {
      cuisine: label(CUISINES),
      noise: label(NOISE),
      dealbreaker: label(DEALBREAKERS),
      wait: label(WAITS),
      company: label(COMPANY),
      vibe: label(VIBES),
    },
  };
});
