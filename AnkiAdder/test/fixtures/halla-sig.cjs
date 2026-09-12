const pairs = [
  ['remain; stay in place', ['Hon höll sig hemma.', 'She stayed home.'], ['Håll dig nära mig.', 'Stay close to me.']],
  ['keep oneself; refrain', ['Han höll sig lugn.', 'He kept calm.'], ['Håll dig från problem.', 'Stay away from trouble.']],
  ['behave; conduct oneself', ['Barnen höll sig snälla.', 'The children behaved well.'], ['Hon höll sig professionell.', 'She remained professional.']],
  ['stay fresh without spoiling', ['Mjölken håller sig längre i kylskåpet.', 'The milk stays fresh longer in the refrigerator.'], ['Grädden höll sig i fem dagar.', 'The cream stayed fresh for five days.']],
];
module.exports = { word: 'hålla sig', lemma: 'hålla sig', pronunciation: '', grammar: '', notes: '', coverage: '', warnings: [], conjugations: [], meanings: pairs.map(([definition, ...examples]) => ({ partOfSpeech: 'verb', definition, usage: '', examples: examples.map(([sentence, translation]) => ({ sentence, translation })) })) };
