import { writeFileSync } from "fs";
import JsConfuser from "../../src/index";

describe("RGF", () => {
  it("should contain `new Function` in the output and work", async () => {
    var output = await JsConfuser.obfuscate(
      `
      function add(a,b){
        return a + b;
      }
      
      input(add(10, 5))
      `,
      {
        target: "node",
        rgf: true,
      }
    );

    expect(output).toContain("new Function");
    var value = "never_called";
    function input(valueIn) {
      value = valueIn;
    }

    eval(output);
    expect(value).toStrictEqual(15);
  });

  it("should work with multiple functions", async () => {
    var output = await JsConfuser.obfuscate(
      `
      function add(a,b){
        return a + b;
      }
  
      function parse(str){
        return parseInt(str);
      }
      
      input(add(parse("20"), 5))
      `,
      {
        target: "node",
        rgf: true,
      }
    );

    expect(output).toContain("new Function");
    var value = "never_called";
    function input(valueIn) {
      value = valueIn;
    }

    eval(output);
    expect(value).toStrictEqual(25);
  });

  it("should not change functions that have references to parent scopes", async () => {
    var output = await JsConfuser.obfuscate(
      `
      var parentScope = 0;
      function add(a,b){

        // reference to parent scope
        return a + parentScope;
      }
      
      input(add(10, 5))
      `,
      {
        target: "node",
        rgf: true,
      }
    );

    expect(output).not.toContain("new Function");
  });

  it("should not change functions that have mutate their parent scopes", async () => {
    var output = await JsConfuser.obfuscate(
      `
      var parentScope = 0;
      function add(a,b){

        // modifies parent scope
        parentScope = 1;
        return a + b;
      }
      
      input(add(10, 5))
      `,
      {
        target: "node",
        rgf: true,
      }
    );

    expect(output).not.toContain("new Function");
  });
});

describe("RGF with the 'all' mode", () => {
  it("should contain `new Function` in the output and work", async () => {
    var output = await JsConfuser.obfuscate(
      `
      function add(a,b){
        return a + b;
      }
      
      input(add(10, 5))
      `,
      {
        target: "node",
        rgf: "all",
      }
    );

    expect(output).toContain("new Function");
    var value = "never_called";
    function input(valueIn) {
      value = valueIn;
    }

    eval(output);
    expect(value).toStrictEqual(15);
  });

  it("should work with multiple functions", async () => {
    var output = await JsConfuser.obfuscate(
      `
      function add(a,b){
        return a + b;
      }
  
      function parse(str){
        return parseInt(str);
      }
      
      input(add(parse("20"), 5))
      `,
      {
        target: "node",
        rgf: "all",
      }
    );

    expect(output).toContain("new Function");
    var value = "never_called";
    function input(valueIn) {
      value = valueIn;
    }

    eval(output);
    expect(value).toStrictEqual(25);
  });

  it("should work with multiple, deeply-nested, functions", async () => {
    var output = await JsConfuser.obfuscate(
      `
     
function getNumbers(){
  return [5, 10];
}

function multiply(x,y){
  return x*y;
}

function testFunction(){
  function add(x,y){
    return x+y;
  }

  function testInnerFunction(){
    var numbers = getNumbers();

    // 5*10 + 10 = 60
    return add(multiply(numbers[0], numbers[1]), numbers[1])
  }

  input( testInnerFunction() );
}

testFunction();
      `,
      {
        target: "node",
        rgf: "all",
      }
    );

    expect(output).toContain("new Function");
    var value = "never_called";
    function input(valueIn) {
      value = valueIn;
    }

    eval(output);
    expect(value).toStrictEqual(60);
  });
});
