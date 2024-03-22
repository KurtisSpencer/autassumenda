import { compileJsSync } from "../compiler";
import { reservedIdentifiers } from "../constants";
import Obfuscator from "../obfuscator";
import { ObfuscateOrder } from "../order";
import { ComputeProbabilityMap } from "../probability";
import Template from "../templates/template";
import traverse, { walk } from "../traverse";
import {
  ArrayExpression,
  CallExpression,
  FunctionExpression,
  Identifier,
  Literal,
  Location,
  MemberExpression,
  NewExpression,
  Node,
  ReturnStatement,
  SpreadElement,
  ThisExpression,
  VariableDeclaration,
  VariableDeclarator,
} from "../util/gen";
import { getDefiningIdentifier, getIdentifierInfo } from "../util/identifiers";
import {
  getVarContext,
  isVarContext,
  isFunction,
  prepend,
} from "../util/insert";
import Transform from "./transform";

/**
 * Converts function to `new Function("..code..")` syntax as an alternative to `eval`. Eval is disabled in many environments.
 *
 * `new Function("..code..")` runs in an isolated context, meaning all local variables are undefined and throw errors.
 *
 * Rigorous checks are in place to only include pure functions.
 *
 * `flatten` can attempt to make function reference-less. Recommended to have flatten enabled with RGF.
 *
 * | Mode | Description |
 * | --- | --- |
 * | `"all"` | Applies to all scopes |
 * | `true` | Applies to the top level only |
 * | `false` | Feature disabled |
 */
export default class RGF extends Transform {
  constructor(o) {
    super(o, ObfuscateOrder.RGF);
  }

  match(object, parents) {
    return isVarContext(object) && object.type !== "ArrowFunctionExpression";
  }

  transform(contextObject, contextParents) {
    return () => {
      var isGlobal = contextObject.type == "Program";

      var value = ComputeProbabilityMap(this.options.rgf, (x) => x, isGlobal);
      if (value !== "all" && !isGlobal) {
        return;
      }

      var collect: {
        location: Location;
        references: Set<string>;
        name?: string;
      }[] = [];
      var queue: Location[] = [];
      var names = new Map<string, number>();
      var definingNodes = new Map<string, Node>();

      walk(contextObject, contextParents, (object, parents) => {
        if (
          object !== contextObject &&
          isFunction(object) &&
          !object.async &&
          !object.generator &&
          getVarContext(parents[0], parents.slice(1)) === contextObject
        ) {
          var defined = new Set<string>(),
            referenced = new Set<string>();

          var isBound = false;

          walk(object.body, [object, ...parents], (o, p) => {
            if (
              o.type == "Identifier" &&
              !reservedIdentifiers.has(o.name) &&
              !this.options.globalVariables.has(o.name)
            ) {
              var info = getIdentifierInfo(o, p);
              if (info.spec.isDefined) {
                defined.add(o.name);
              } else if (info.spec.isReferenced || info.spec.isModified) {
                referenced.add(o.name);
              }
            }

            if (o.type == "ThisExpression" || o.type == "Super") {
              isBound = true;
            }
          });

          if (!isBound) {
            defined.forEach((identifier) => {
              referenced.delete(identifier);
            });

            object.params.forEach((param) => {
              referenced.delete(param.name);
            });

            collect.push({
              location: [object, parents],
              references: referenced,
              name: object.id?.name,
            });
          }
        }
      });

      if (!collect.length) {
        return;
      }

      var miss = 0;
      var start = collect.length * 2;

      while (true) {
        var hit = false;

        collect.forEach(
          ({ name, references: references1, location: location1 }) => {
            if (!references1.size && name) {
              collect.forEach((o) => {
                if (
                  o.location[0] !== location1[0] &&
                  o.references.size &&
                  o.references.delete(name)
                ) {
                  // console.log(collect);

                  hit = true;
                }
              });
            }
          }
        );
        if (hit) {
          miss = 0;
        } else {
          miss++;
        }

        if (miss > start) {
          break;
        }
      }

      queue = [];
      collect.forEach((o) => {
        if (!o.references.size) {
          var [object, parents] = o.location;

          queue.push([object, parents]);
          if (
            object.type == "FunctionDeclaration" &&
            typeof object.id.name === "string"
          ) {
            var index = names.size;

            names.set(object.id.name, index);
            definingNodes.set(object.id.name, object.id);
          }
        }
      });

      if (!queue.length) {
        return;
      }

      var referenceArray = this.generateIdentifier();

      walk(contextObject, contextParents, (o, p) => {
        if (o.type == "Identifier" && !reservedIdentifiers.has(o.name)) {
          var index = names.get(o.name);
          if (typeof index === "number") {
            var info = getIdentifierInfo(o, p);
            if (info.spec.isReferenced && !info.spec.isDefined) {
              var location = getDefiningIdentifier(o, p);
              if (location) {
                var pointingTo = location[0];
                var shouldBe = definingNodes.get(o.name);

                // console.log(pointingTo, shouldBe);

                if (pointingTo == shouldBe) {
                  this.log(o.name, "->", `${referenceArray}[${index}]`);

                  this.replace(
                    o,
                    FunctionExpression(
                      [],
                      [
                        ReturnStatement(
                          CallExpression(
                            MemberExpression(
                              Identifier(referenceArray),
                              Literal(index),
                              true
                            ),
                            [
                              Identifier(referenceArray),
                              SpreadElement(Identifier("arguments")),
                            ]
                          )
                        ),
                      ]
                    )
                  );
                }
              }
            }
          }
        }
      });

      var arrayExpression = ArrayExpression([]);
      var variableDeclaration = VariableDeclaration([
        VariableDeclarator(Identifier(referenceArray), arrayExpression),
      ]);

      prepend(contextObject, variableDeclaration);

      queue.forEach(([object, parents]) => {
        var name = object?.id?.name;
        var hasName = !!name;
        var params = object.params.map((x) => x.name) || [];

        var embeddedName = name || this.getPlaceholder();

        // Since `new Function` is completely isolated, create an entire new obfuscator and run remaining transformations.
        // RGF runs early and needs completed code before converting to a string.
        // (^ the variables haven't been renamed yet)
        var o = new Obfuscator({
          ...this.options,
          rgf: false,
          globalVariables: new Set([
            ...this.options.globalVariables,
            referenceArray,
          ]),
          lock: {
            integrity: false,
          },
          eval: false,
        });
        var t = Object.values(o.transforms).filter(
          (x) => x.priority > this.priority
        );

        var embeddedFunction = {
          ...object,
          type: "FunctionDeclaration",
          id: Identifier(embeddedName),
        };

        var tree = {
          type: "Program",
          body: [
            embeddedFunction,
            ReturnStatement(
              CallExpression(
                MemberExpression(
                  Identifier(embeddedName),
                  Identifier("call"),
                  false
                ),
                [
                  ThisExpression(),
                  SpreadElement(
                    Template(
                      `Array.prototype.slice.call(arguments, 1)`
                    ).single().expression
                  ),
                ]
              )
            ),
          ],
        };

        (tree as any).__hiddenDeclarations = VariableDeclaration(
          VariableDeclarator(referenceArray)
        );
        (tree as any).__hiddenDeclarations.hidden = true;

        t.forEach((x) => {
          x.apply(tree);
        });

        // Find eval callbacks
        traverse(tree, (o, p) => {
          if (o.$eval) {
            return () => {
              o.$eval();
            };
          }
        });

        var toString = compileJsSync(tree, this.options);

        var newFunction = NewExpression(Identifier("Function"), [
          Literal(referenceArray),
          Literal(toString),
        ]);

        if (hasName) {
          arrayExpression.elements[names.get(name)] = newFunction;

          if (Array.isArray(parents[0])) {
            parents[0].splice(parents[0].indexOf(object), 1);
          } else {
            this.error(
              new Error(
                "Error deleting function declaration: " +
                  parents.map((x) => x.type).join(",")
              )
            );
          }
        } else {
          this.replace(object, newFunction);
        }
      });
    };
  }
}
