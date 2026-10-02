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
    { value: 'american', label: 'American', emoji: '🍔' },
    { value: 'italian', label: 'Italian & pizza', emoji: '🍝' },
    { value: 'mexican', label: 'Mexican', emoji: '🌮' },
    { value: 'chinese', label: 'Chinese', emoji: '🥟' },
    { value: 'japanese', label: 'Japanese & sushi', emoji: '🍣' },
    { value: 'thai', label: 'Thai', emoji: '🍜' },
    { value: 'asian', label: 'Other Asian', emoji: '🥢' },
    { value: 'indian', label: 'Indian', emoji: '🍛' },
    { value: 'mediterranean', label: 'Mediterranean', emoji: '🫒' },
    { value: 'cafe', label: 'Café & crêpes', emoji: '🥐' },
    { value: 'brunch', label: 'Breakfast & brunch', emoji: '🥞' },
    { value: 'seafood', label: 'Seafood', emoji: '🦞' },
    { value: 'steak', label: 'Steak & BBQ', emoji: '🥩' },
    { value: 'pub', label: 'Brewery & pub', emoji: '🍺' },
    { value: 'vegetarian', label: 'Veggie & healthy', emoji: '🥗' },
    { value: 'any', label: 'Surprise me', emoji: '🎲' },
  ];

  const NOISE = [
    { value: 'quiet', label: 'Quiet', emoji: '🤫', hint: 'Easy conversation' },
    { value: 'buzz', label: 'Light buzz', emoji: '🙂', hint: 'Lively but relaxed' },
    { value: 'high', label: 'High energy', emoji: '🎉', hint: 'Hip & loud is fine' },
  ];

  const DEALBREAKERS = [
    { value: 'messy', label: 'Messy', emoji: '🧹' },
    { value: 'no_parking', label: 'No parking', emoji: '🅿️' },
    { value: 'rude_service', label: 'Rude service', emoji: '😤' },
    { value: 'pricey', label: 'Too pricey', emoji: '💸' },
    { value: 'loud', label: 'Too loud', emoji: '📢' },
  ];

  const WAITS = [
    { value: 0, label: 'Seat me now', emoji: '⚡' },
    { value: 15, label: 'Up to 15 min', emoji: '⏱️' },
    { value: 30, label: 'Up to 30 min', emoji: '⏳' },
    { value: 60, label: 'Up to an hour', emoji: '🕐' },
    { value: 999, label: "I'll wait for something great", emoji: '🧘' },
  ];

  const COMPANY = [
    { value: 'solo', label: 'Just me', emoji: '🙋' },
    { value: 'partner', label: 'Partner', emoji: '💞' },
    { value: 'friends', label: 'Friends', emoji: '👯' },
    { value: 'family', label: 'Family', emoji: '👨‍👩‍👧' },
    { value: 'coworkers', label: 'Coworkers', emoji: '💼' },
  ];

  const VIBES = [
    { value: 'views', label: 'Views & scenery', emoji: '🌅' },
    { value: 'design', label: 'Beautiful design & lighting', emoji: '💡' },
    { value: 'patio', label: 'Outdoor seating', emoji: '🌿' },
    { value: 'live_music', label: 'Live music', emoji: '🎸' },
    { value: 'cozy', label: 'Cozy & intimate', emoji: '🕯️' },
    { value: 'local', label: 'Local art & character', emoji: '🎨' },
  ];

  const QUIZ = [
    { id: 'name', type: 'text', prompt: 'First, what should we call you?', placeholder: 'Your first name' },
    {
      id: 'cuisines', type: 'multi', options: CUISINES, exclusive: 'any',
      prompt: 'What food genre are you craving today?',
      hint: 'Pick as many as sound good.',
    },
    {
      id: 'novelty', type: 'single',
      prompt: 'Today, are you looking to…',
      options: [
        { value: 'favorites', label: 'Stick to favorites', emoji: '❤️' },
        { value: 'new', label: 'Try something new', emoji: '🧭' },
      ],
    },
    { id: 'noise', type: 'single', prompt: 'Ideal noise level?', options: NOISE },
    {
      id: 'dealbreakers', type: 'multi', options: DEALBREAKERS, optional: true,
      prompt: 'Instant dealbreaker?',
      hint: 'Anything you pick knocks a place off the list for the whole group. Skip if nothing.',
    },
    { id: 'maxWait', type: 'single', prompt: 'How long will you wait for a table?', options: WAITS },
    { id: 'diningWith', type: 'single', prompt: 'Who are you dining with today?', options: COMPANY },
    {
      id: 'vibes', type: 'multi', options: VIBES, optional: true,
      prompt: 'Bonus: what makes a place feel special to you?',
      hint: 'Optional, but this is what makes a meal memorable for most people.',
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
